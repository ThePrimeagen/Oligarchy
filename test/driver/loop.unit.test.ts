import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Fiber, FileSystem, Layer, PlatformError, Redacted } from "effect";
import * as Errors from "../../src/shared/errors.ts";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import * as HarnessConfig from "../../src/harness/config.ts";
import * as DriverLog from "../../src/driver/log.ts";
import * as Loop from "../../src/driver/loop.ts";
import * as Support from "../support/config.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TOKEN = "super-secret-token";
const MODEL = "openrouter/test-model";
const RESULT = "22222222-2222-4222-8222-222222222222";
const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";
const LOG = "/tmp/driver-debug.log";
const MODEL_URL = "https://openrouter.ai/api/v1/chat/completions";

const config = (overrides?: {
  readonly stepLimit?: number;
  readonly runCeiling?: string;
  readonly header?: string;
  readonly chunk?: string;
  readonly defaultRetry?: string;
}) =>
  HarnessConfig.parse(
    JSON.stringify({
      models: { drive: MODEL, diagnose: MODEL, mint: MODEL },
      openRouterBaseUrl: "https://openrouter.ai/api/v1",
      timeouts: {
        header: overrides?.header ?? "3 minutes",
        chunk: overrides?.chunk ?? "3 minutes",
      },
      runCeiling: overrides?.runCeiling ?? "1 hour",
      stepLimit: overrides?.stepLimit ?? 20,
      harness: { defaultRetry: overrides?.defaultRetry ?? "1 second" },
    }),
  );

const frame = (body: unknown): string => JSON.stringify(body);

const sse = (frames: ReadonlyArray<string>): Response =>
  new Response(frames.map((line) => `data: ${line}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const call = (body: unknown): Response =>
  sse([
    frame({
      choices: [{ delta: { content: JSON.stringify(body) }, finish_reason: null }],
    }),
    frame({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "[DONE]",
  ]);

const client = (reason: string, args: ReadonlyArray<string>): Response =>
  call({ name: "client", arguments: { reason, args } });

const done = (): Response => call({ name: "Done", arguments: {} });

// The action strings below are the flags the model used to pass. Split them the way a shell
// would, so a quoted reason stays one argument.
const tokens = (action: string): ReadonlyArray<string> => {
  const args: Array<string> = [];
  let current = "";
  let quote: string | undefined;
  for (const char of action) {
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t") {
      if (current !== "") {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current !== "") {
    args.push(current);
  }
  return args;
};

const speak = (_status: "continue" | "complete", did: string, action: string): Response =>
  client(did, tokens(action));

const stopped = (_content: string): Response => done();

const sendKeys = (did: string | null = "lock the screen") =>
  speak("continue", did ?? "send-keys", "send-keys --keys a");

const start = () => speak("continue", "boot", "start --iso https://example.com/omarchy.iso");

const resumed = () => speak("continue", "boot", "start --resume");

const stop = () => speak("continue", "halt", "stop --status succeeded");

const answers = (...replies: ReadonlyArray<Response>) => {
  let calls = 0;
  return () => {
    const reply = replies[calls] ?? replies[replies.length - 1];
    calls += 1;
    return reply ?? stopped("done");
  };
};

const intentCall = () => speak("continue", "bad", "intent start --message lock");

const isModel = (url: URL): boolean => url.origin === "https://openrouter.ai";

const routed = (
  model: () => Response,
  guest: (url: URL) => Response = (url) =>
    url.pathname === "/start" ? FakeHttp.json({ id: SESSION }) : FakeHttp.json({ ok: "true" }),
) => FakeHttp.recordRequests((_request, url) => (isModel(url) ? model() : guest(url)));

const modelRequests = (
  requests: ReadonlyArray<FakeHttp.Recorded>,
): ReadonlyArray<FakeHttp.Recorded> => requests.filter((request) => isModel(new URL(request.url)));

const guestRequests = (
  requests: ReadonlyArray<FakeHttp.Recorded>,
): ReadonlyArray<FakeHttp.Recorded> => requests.filter((request) => !isModel(new URL(request.url)));

const guestPaths = (requests: ReadonlyArray<FakeHttp.Recorded>): ReadonlyArray<string> =>
  guestRequests(requests).map((request) => new URL(request.url).pathname);

const askText = (requests: ReadonlyArray<FakeHttp.Recorded>, index: number): string =>
  userText(modelRequests(requests)[index]?.body);

const past = (requests: ReadonlyArray<FakeHttp.Recorded>, index: number): string =>
  reasons(modelRequests(requests)[index]?.body);

type Script = FakeSpawner.Script;

const capturingFs = (
  log: Array<string>,
  write?: Effect.Effect<void, PlatformError.PlatformError>,
) =>
  FileSystem.layerNoop({
    writeFileString: (_path, data) => {
      if (write !== undefined) {
        return write;
      }
      return Effect.sync(() => {
        log.push(data);
      });
    },
  });

const events = (log: ReadonlyArray<string>): ReadonlyArray<DriverLog.Event> =>
  log.map((line) => DriverLog.decodeLine(line.trim()));

const fields = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null;

const messageText = (body: string | undefined, role: string): string => {
  const value: unknown = JSON.parse(body ?? "{}");
  if (!fields(value) || !Array.isArray(value.messages)) {
    return "";
  }
  for (const message of value.messages) {
    if (!fields(message) || message.role !== role || typeof message.content !== "string") {
      continue;
    }
    return message.content;
  }
  return "";
};

const userText = (body: string | undefined): string => messageText(body, "user");

const systemText = (body: string | undefined): string => messageText(body, "system");

// The guide also mentions intents and reservations. The past steps are the decisions.
const reasons = (body: string | undefined): string => {
  const system = systemText(body);
  const marker = "Past steps:\n";
  const at = system.indexOf(marker);
  if (at === -1) {
    return "";
  }
  const from = at + marker.length;
  const end = system.indexOf("</progress>", from);
  return system.slice(from, end === -1 ? undefined : end).trim();
};

const denied = PlatformError.systemError({
  _tag: "PermissionDenied",
  module: "FileSystem",
  method: "writeFileString",
  pathOrDescriptor: LOG,
  syscall: "open",
  cause: new Error(`EACCES: permission denied, open '${LOG}'`),
});

const run = (
  app: Effect.Effect<HarnessConfig.AppConfig, Errors.CommandError>,
  http: Layer.Layer<HttpClient.HttpClient>,
  script: Script,
  log: Array<string>,
  options?: {
    readonly write?: Effect.Effect<void, PlatformError.PlatformError>;
    readonly env?: Record<string, string>;
    readonly prompt?: string;
    readonly testDefinition?: string;
    readonly testProof?: string;
    readonly agentId?: string;
    readonly serverUrl?: string;
  },
) =>
  Effect.gen(function* () {
    const parsed = yield* app;
    const spawner = FakeSpawner.fakeSpawner(script);
    const prompt = options?.prompt ?? "Lock the screen.";
    const stoppedRun = yield* Loop.run({
      model: MODEL,
      prompt,
      testDefinition: options?.testDefinition ?? prompt,
      testProof: options?.testProof ?? "none",
      agentId: options?.agentId ?? "OLI-1",
      serverUrl: options?.serverUrl ?? "http://127.0.0.1:9",
      testResultId: RESULT,
      debugLog: LOG,
      config: parsed,
      token: Redacted.make(TOKEN),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          capturingFs(log, options?.write),
          http,
          spawner.layer,
          NodePath.layer,
          Support.withEnv(options?.env ?? { OLIGARCHY_TOKEN: TOKEN }),
        ),
      ),
    );
    return { stopped: stoppedRun, spawner, log };
  });

describe("driver loop", () => {
  it.effect(
    "brackets a guest action with intent start and end, then stops when the model does",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(
            start(),
            speak(
              "continue",
              "lock the screen",
              "send-keys --agent-id WRONG --session-id bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb --server-url http://stolen.example --keys a",
            ),
            stopped("done"),
          ),
        );
        const log: Array<string> = [];
        const { stopped: outcome, spawner } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
        );
        expect(outcome).toEqual({ reason: "model-stopped" });
        expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl"]);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/intent/end",
        ]);
        const opened = guestRequests(recorder.requests)[1];
        expect(opened?.url.startsWith("http://127.0.0.1:9/intent/start")).toBe(true);
        expect(opened?.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(JSON.parse(opened?.body ?? "{}")).toEqual({
          id: SESSION,
          agent: "OLI-1",
          test_result_id: RESULT,
          message: "lock the screen",
        });
        expect(JSON.parse(guestRequests(recorder.requests)[2]?.body ?? "{}")).toMatchObject({
          id: SESSION,
          agent: "OLI-1",
          keys: "a",
        });
        expect(guestRequests(recorder.requests)[2]?.url).not.toContain("stolen.example");

        expect(modelRequests(recorder.requests)).toHaveLength(3);
        const first = modelRequests(recorder.requests)[0];
        expect(first?.url).toBe(MODEL_URL);
        expect(first?.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(JSON.parse(first?.body ?? "{}")).toMatchObject({
          model: MODEL,
          tools: [],
          messages: [
            { role: "system", content: expect.stringContaining("You MUST use a tool") },
            { role: "user", content: "Lock the screen." },
          ],
        });
        const system = systemText(first?.body);
        expect(system).toContain("./client start");
        expect(system).toContain("This is step 1.");
        expect(system).toContain("<def>\nLock the screen.\n</def>");
        expect(system).toContain("<proof>\nnone\n</proof>");
        expect(system).toContain("Past steps:\nnone");
        expect(system).toContain("<context>");
        expect(system).toContain("Never take more than two screenshots in a row.");
        expect(system).not.toContain("{{");
        expect(past(recorder.requests, 0)).toBe("none");
        expect(askText(recorder.requests, 1)).toBe("Lock the screen.");
        expect(askText(recorder.requests, 2)).toBe("Lock the screen.");
        expect(systemText(modelRequests(recorder.requests)[1]?.body)).toContain("This is step 2.");
        expect(past(recorder.requests, 1)).toContain(SESSION);
        expect(past(recorder.requests, 2)).toContain("lock the screen");
        expect(JSON.parse(modelRequests(recorder.requests)[1]?.body ?? "{}")).toMatchObject({
          messages: [{ role: "system" }, { role: "user" }],
        });

        const kinds = events(log).map((event) => event.kind);
        expect(kinds).toContain("request");
        expect(kinds).toContain("assistant");
        expect(kinds).toContain("command");
        expect(kinds[kinds.length - 1]).toBe("stop");
        expect(events(log).at(-1)?.text).toBe("model-stopped");
        expect(events(log).some((event) => event.kind === "intent" && event.step === 2)).toBe(true);
        expect(log.join("")).not.toContain(TOKEN);
      }),
  );

  it.effect("marks a resumed start running and logs resume and routing", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? resumed() : stopped("done");
      });
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (command, args) => {
          expect(command).toBe("./ctrl");
          expect(args).toEqual([
            "test",
            "start",
            "--session-id",
            SESSION,
            "--test-result-id",
            RESULT,
            "--model",
            MODEL,
          ]);
          return { exitCode: 0 };
        },
        log,
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl"]);
      expect(guestPaths(recorder.requests)).toEqual(["/start"]);
      const lines = events(log);
      const started = lines.find((event) => event.kind === "start");
      expect(started).toMatchObject({ step: 1, kind: "start" });
      expect(started?.text.endsWith("resume routing http://127.0.0.1:9")).toBe(true);
      expect(lines.find((event) => event.kind === "running")).toEqual({
        step: 1,
        kind: "running",
        text: SESSION,
      });
      expect(past(recorder.requests, 1)).toContain(SESSION);
    }),
  );

  it.effect("a start without resume or routing is still marked running", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const log: Array<string> = [];
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log, { serverUrl: "" });
      const lines = events(log);
      const started = lines.find((event) => event.kind === "start");
      expect(started?.text).not.toContain("resume");
      expect(started?.text).not.toContain("routing");
      expect(lines.find((event) => event.kind === "running")?.text).toBe(SESSION);
    }),
  );

  it.effect("does not mark a machine running when start fails", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(
        () => {
          calls += 1;
          return calls === 1 ? resumed() : stopped("done");
        },
        () => FakeHttp.json({ error: "no reservation" }, 400),
      );
      const log: Array<string> = [];
      const { spawner } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
      expect(spawner.spawned).toEqual([]);
      expect(guestPaths(recorder.requests)).toEqual(["/start"]);
      expect(events(log).some((event) => event.kind === "running")).toBe(false);
      expect(past(recorder.requests, 1)).toContain("no reservation");
    }),
  );

  it.effect("a failed running mark stays in the tool result", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 1, stderr: "not pending\n" }),
        log,
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl"]);
      expect(past(recorder.requests, 1)).toContain(SESSION);
      expect(past(recorder.requests, 1)).toContain("not pending");
      expect(events(log).find((event) => event.kind === "running")?.text).toBe(SESSION);
    }),
  );

  it.effect("a missing ctrl stays in the tool result and the loop continues", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ spawnError: "ENOENT: no such file or directory, posix_spawn './ctrl'" }),
        [],
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned).toEqual([]);
      expect(past(recorder.requests, 1)).toContain("./ctrl");
      expect(past(recorder.requests, 1)).toContain("ENOENT");
    }),
  );

  it.effect("does not intent start, reserve, or a refused intent call", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? intentCall() : stopped("stopped");
      });
      const log: Array<string> = [];
      const { spawner } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
      expect(spawner.spawned).toEqual([]);
      expect(guestRequests(recorder.requests)).toEqual([]);
      expect(events(log).some((event) => event.kind === "refusal")).toBe(true);
      expect(past(recorder.requests, 1)).toContain("intent");
    }),
  );

  it.effect("closes the result when stop exits 0 and does not ask the model again", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(start(), stop()));
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) => {
          if (args[1] === "start") {
            return { exitCode: 0, stdout: "" };
          }
          expect(args).toEqual([
            "test-results",
            "--agent-id",
            "OLI-1",
            "--id",
            RESULT,
            "--status",
            "success",
          ]);
          return { exitCode: 0, stdout: "" };
        },
        log,
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(modelRequests(recorder.requests)).toHaveLength(2);
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl", "./ctrl"]);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/stop"]);
      expect(JSON.parse(guestRequests(recorder.requests)[1]?.body ?? "{}")).toMatchObject({
        id: SESSION,
        agent: "OLI-1",
        status: "succeeded",
      });
      expect(events(log).at(-1)).toMatchObject({ kind: "stop", text: "result-closed" });
    }),
  );

  it.effect("a failed stop closes the result failed, with the reason", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(
          start(),
          speak("continue", "the installer hung", `stop --status failed --reason "installer hung"`),
        ),
      );
      const { spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0, stdout: "" }),
        [],
      );
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl", "./ctrl"]);
      expect(spawner.spawned[1]?.args).toEqual([
        "test-results",
        "--agent-id",
        "OLI-1",
        "--id",
        RESULT,
        "--status",
        "failed",
        "--reason",
        "installer hung",
      ]);
    }),
  );

  it.effect("a save closes the result as a success", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(start(), speak("continue", "kept the disk", "save")));
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0, stdout: "" }),
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl", "./ctrl"]);
      expect(spawner.spawned[1]?.args).toContain("success");
      expect(modelRequests(recorder.requests)).toHaveLength(2);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/save"]);
    }),
  );

  it.effect(
    "a test-results failure is a loop failure and does not ask the model again (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(start(), stop()));
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 1, stderr: "result is aborted\n" }), []),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain("aborted");
        }
        expect(modelRequests(recorder.requests)).toHaveLength(2);
      }),
  );

  it.effect("a stop before the harness has a session does not close the result (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(stop(), stopped("done")));
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        () => {
          expect.fail("a stop with no session does not run ./ctrl");
        },
        [],
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned).toEqual([]);
      expect(guestRequests(recorder.requests)).toEqual([]);
      expect(past(recorder.requests, 1)).toContain("no session");
    }),
  );

  it.effect("does not run the guest command when intent start fails", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(start(), sendKeys(null), stopped("stopped")), (url) => {
        if (url.pathname === "/start") {
          return FakeHttp.json({ id: SESSION });
        }
        return url.pathname === "/intent/start"
          ? FakeHttp.json({ error: "Cannot start one intent when one's already running." }, 400)
          : FakeHttp.json({ ok: "true" });
      });
      const log: Array<string> = [];
      const { spawner } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl"]);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start"]);
      expect(past(recorder.requests, 2)).toContain("already running");
      expect(past(recorder.requests, 2)).not.toContain("typed");
    }),
  );

  it.effect("closes the intent when the guest command fails", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(start(), sendKeys("press the key"), stopped("stopped")),
        (url) => {
          if (url.pathname === "/start") {
            return FakeHttp.json({ id: SESSION });
          }
          return url.pathname === "/send-keys"
            ? FakeHttp.json({ error: "keys refused" }, 400)
            : FakeHttp.json({ ok: "true" });
        },
      );
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(guestPaths(recorder.requests)).toEqual([
        "/start",
        "/intent/start",
        "/send-keys",
        "/intent/end",
      ]);
      expect(past(recorder.requests, 2)).toContain("keys refused");
    }),
  );

  it.effect("keeps the command output when intent end fails", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(start(), sendKeys("press the key"), stopped("stopped")),
        (url) => {
          if (url.pathname === "/start") {
            return FakeHttp.json({ id: SESSION });
          }
          return url.pathname === "/intent/end"
            ? FakeHttp.json({ error: "no intent open" }, 400)
            : FakeHttp.json({ ok: "true" });
        },
      );
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(guestPaths(recorder.requests)).toEqual([
        "/start",
        "/intent/start",
        "/send-keys",
        "/intent/end",
      ]);
      expect(past(recorder.requests, 2)).toContain("intent end failed");
      expect(past(recorder.requests, 2)).toContain("no intent open");
    }),
  );

  it.effect("a long command output is clipped in the next ask", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(
        () => {
          calls += 1;
          return calls === 1 ? start() : stopped("done");
        },
        () => FakeHttp.json({ error: "x".repeat(2_000) }, 400),
      );
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      const again = past(recorder.requests, 1);
      expect(again).toContain("x".repeat(100));
      expect(again).not.toContain("x".repeat(501));
      expect(askText(recorder.requests, 1)).toBe("Lock the screen.");
    }),
  );

  it.effect("a reply that is not one tool call fails the loop and runs nothing", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        sse([
          frame({ choices: [{ delta: { content: "hello" }, finish_reason: null }] }),
          frame({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          "[DONE]",
        ]),
      );
      const error = yield* Effect.flip(run(config(), recorder.layer, () => ({ exitCode: 0 }), []));
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("reply:");
        expect(error.message).not.toContain("3 lines");
      }
    }),
  );

  it.effect("fills the system prompt from the definition and proof it was given", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => stopped("done"));
      const task = "<instruction>not this</instruction><proof>not this either</proof>";
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
        prompt: task,
        testDefinition: "Lock it from the menu.",
        testProof: "The screen is locked.",
      });
      const system = systemText(modelRequests(recorder.requests)[0]?.body);
      expect(system).toContain("<def>\nLock it from the menu.\n</def>");
      expect(system).toContain("<proof>\nThe screen is locked.\n</proof>");
      expect(system).not.toContain("not this");
      expect(askText(recorder.requests, 0)).toBe(task);
    }),
  );

  it.effect("a refused OpenRouter request exits with the reason and runs nothing", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response(JSON.stringify({ error: { message: "no credits" } }), {
            status: 402,
            headers: { "content-type": "application/json" },
          }),
      );
      const log: Array<string> = [];
      const error = yield* Effect.flip(run(config(), recorder.layer, () => ({ exitCode: 0 }), log));
      expect(error._tag).toBe("OpenRouterRefusal");
      if (error._tag === "OpenRouterRefusal") {
        expect(error.status).toBe(402);
        expect(error.message).toBe("no credits");
      }
      expect(
        events(log).some((event) => event.kind === "failure" && event.text.includes("no credits")),
      ).toBe(true);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  it.effect("an unreachable OpenRouter is a loop failure and runs nothing", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:443"),
            }),
          }),
        ),
      );
      const log: Array<string> = [];
      const error = yield* Effect.flip(run(config(), layer, () => ({ exitCode: 0 }), log));
      expect(error._tag).toBe("OpenRouterUnreachable");
      expect(events(log).some((event) => event.kind === "failure")).toBe(true);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  it.effect("the step limit is a loop failure after the counted calls", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => start());
      const log: Array<string> = [];
      const error = yield* Effect.flip(
        run(config({ stepLimit: 1 }), recorder.layer, () => ({ exitCode: 0, stdout: "id\n" }), log),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("step limit");
        expect(error.message).toContain("1");
      }
      expect(modelRequests(recorder.requests)).toHaveLength(1);
      expect(events(log).at(-1)?.kind).toBe("failure");
    }),
  );

  it.effect("the run ceiling is a loop failure and names the ceiling", () =>
    Effect.gen(function* () {
      // Start returns at once. The clock moves while ./ctrl test start is still running,
      // so the next turn is already past the ceiling and the model is not asked again.
      const recorder = routed(() => start());
      const log: Array<string> = [];
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const parsed = yield* config({
        runCeiling: "2 seconds",
        header: "1 second",
        chunk: "1 second",
        defaultRetry: "100 millis",
      });
      const fiber = yield* Loop.run({
        model: MODEL,
        prompt: "Lock the screen.",
        testDefinition: "Lock the screen.",
        testProof: "none",
        agentId: "OLI-1",
        serverUrl: "http://127.0.0.1:9",
        testResultId: RESULT,
        debugLog: LOG,
        config: parsed,
        token: Redacted.make(TOKEN),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            capturingFs(log),
            recorder.layer,
            spawner.layer,
            NodePath.layer,
            Support.withEnv({ OLIGARCHY_TOKEN: TOKEN }),
          ),
        ),
        Effect.forkScoped,
      );
      const marked = yield* spawner.nextSpawn;
      yield* TestClock.setTime(2_000);
      yield* marked.exit(0);
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("run ceiling");
      }
      expect(modelRequests(recorder.requests)).toHaveLength(1);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  it.effect("a missing token is the action's failure and the loop continues", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        log,
        { env: {} },
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned).toEqual([]);
      expect(guestRequests(recorder.requests)).toEqual([]);
      expect(past(recorder.requests, 1)).toContain("OLIGARCHY_TOKEN is not set");
    }),
  );

  it.effect("an unknown flag is the action's failure and the loop continues", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1 ? speak("continue", "boot", "start --nope") : stopped("done");
      });
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(guestRequests(recorder.requests)).toEqual([]);
      expect(past(recorder.requests, 1)).toContain("--nope");
    }),
  );

  it.effect("a ./client-with-image action is an unknown command and takes no screenshot", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = routed(() => {
        calls += 1;
        return calls === 1
          ? speak(
              "continue",
              "lock the screen",
              `./client-with-image send-keys --agent-id OLI-1 --session-id ${SESSION} --server-url http://127.0.0.1:9 --keys a`,
            )
          : stopped("done");
      });
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(guestRequests(recorder.requests)).toEqual([]);
      expect(past(recorder.requests, 1)).toContain("./client-with-image");
    }),
  );

  it.effect("a debug log that cannot be written fails the loop", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => stopped("done"));
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], { write: Effect.fail(denied) }),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("debug log");
        expect(error.message).toContain("EACCES");
      }
      expect(recorder.requests).toEqual([]);
    }),
  );
});
