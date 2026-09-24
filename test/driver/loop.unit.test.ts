import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, PlatformError, Redacted } from "effect";
import * as Errors from "../../src/shared/errors.ts";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import * as HarnessConfig from "../../src/harness/config.ts";
import * as DriverLog from "../../src/driver/log.ts";
import * as Loop from "../../src/driver/loop.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TOKEN = "super-secret-token";
const MODEL = "openrouter/test-model";
const RESULT = "22222222-2222-4222-8222-222222222222";
const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";
const LOG = "/tmp/driver-debug.log";
const URL = "https://openrouter.ai/api/v1/chat/completions";

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

const drive = (body: unknown): Response =>
  sse([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: { name: "drive", arguments: JSON.stringify(body) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    frame({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    "[DONE]",
  ]);

const reply = (status: "continue" | "complete", actionTaken: string, action: unknown): Response =>
  drive({ status, actionTaken, action });

const stopped = (actionTaken = "done"): Response =>
  reply("complete", actionTaken, { _tag: "save" });

const sendKeys = (actionTaken = "lock the screen") =>
  reply("continue", actionTaken, { _tag: "send-keys", keys: "a" });

const start = () => reply("continue", "boot", { _tag: "start" });

const resumed = () => reply("continue", "boot", { _tag: "start", resume: true });

const stop = () => reply("continue", "halt", { _tag: "stop", status: "succeeded" });

const reserve = () => reply("continue", "give it back", { _tag: "reserve" });

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
    readFileString: (path) => Effect.sync(() => readFileSync(path, "utf8")),
  });

const events = (log: ReadonlyArray<string>): ReadonlyArray<DriverLog.Event> =>
  log.map((line) => DriverLog.decodeLine(line.trim()));

const fields = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null;

const userText = (body: string | undefined): string => {
  const value: unknown = JSON.parse(body ?? "{}");
  if (!fields(value) || !Array.isArray(value.messages)) {
    return "";
  }
  for (const message of value.messages) {
    if (!fields(message) || message.role !== "user" || typeof message.content !== "string") {
      continue;
    }
    return message.content;
  }
  return "";
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
  write?: Effect.Effect<void, PlatformError.PlatformError>,
  session?: { readonly id: string | undefined },
) =>
  Effect.gen(function* () {
    const parsed = yield* app;
    const spawner = FakeSpawner.fakeSpawner(script);
    const stoppedRun = yield* Loop.run({
      model: MODEL,
      prompt: "Lock the screen.",
      testResultId: RESULT,
      debugLog: LOG,
      agentId: "OLI-1",
      serverUrl: "http://127.0.0.1:9",
      sessionId: session === undefined ? SESSION : session.id,
      config: parsed,
      token: Redacted.make(TOKEN),
    }).pipe(Effect.provide(Layer.mergeAll(capturingFs(log, write), http, spawner.layer)));
    return { stopped: stoppedRun, spawner, log };
  });

describe("driver loop", () => {
  it.effect(
    "brackets a guest action with intent start and end, then stops when the model does",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const recorder = FakeHttp.recordRequests(() => {
          calls += 1;
          return calls === 1 ? sendKeys() : stopped("done");
        });
        const log: Array<string> = [];
        const { stopped: outcome, spawner } = yield* run(
          config(),
          recorder.layer,
          (command, args) => {
            if (args[0] === "intent") {
              return { exitCode: 0 };
            }
            expect(command).toBe("./client");
            expect(args[0]).toBe("send-keys");
            return { exitCode: 0, stdout: "typed\n" };
          },
          log,
        );
        expect(outcome).toEqual({ reason: "model-stopped" });
        expect(
          spawner.spawned.map((child) => [child.command, child.args[0], child.args[1]]),
        ).toEqual([
          ["./client", "intent", "start"],
          ["./client", "send-keys", "--agent-id"],
          ["./client", "intent", "end"],
        ]);
        const startArgs = spawner.spawned[0]?.args ?? [];
        expect(startArgs).toContain("--test-result-id");
        expect(startArgs).toContain(RESULT);
        expect(startArgs).toContain("--message");
        expect(startArgs).toContain("lock the screen");
        expect(startArgs).toContain("--server-url");
        expect(startArgs).toContain("http://127.0.0.1:9");

        expect(recorder.requests).toHaveLength(2);
        const first = recorder.requests[0];
        expect(first?.url).toBe(URL);
        expect(first?.headers.authorization).toBe(`Bearer ${TOKEN}`);
        const firstBody = JSON.parse(first?.body ?? "{}");
        expect(firstBody).toMatchObject({
          model: MODEL,
          tool_choice: { type: "function", function: { name: "drive" } },
          messages: [
            { role: "system", content: expect.stringContaining("fractions of the screenshot") },
            { role: "user", content: "Lock the screen." },
          ],
        });
        expect(firstBody.tools).toMatchObject([{ type: "function", function: { name: "drive" } }]);
        const toolText = JSON.stringify(firstBody.tools);
        expect(toolText).not.toContain("agentId");
        expect(toolText).not.toContain("sessionId");
        expect(toolText).not.toContain("serverUrl");
        expect(toolText).not.toContain("testResultId");
        expect(first?.headers["anthropic-beta"]).toBeUndefined();
        expect(firstBody.messages[0].content).not.toContain(RESULT);
        const again = userText(recorder.requests[1]?.body);
        expect(again).toContain("Lock the screen.");
        expect(again).toContain("lock the screen: typed");
        expect(JSON.parse(recorder.requests[1]?.body ?? "{}")).toMatchObject({
          messages: [{ role: "system" }, { role: "user" }],
        });

        const kinds = events(log).map((event) => event.kind);
        expect(kinds).toContain("request");
        expect(kinds).toContain("assistant");
        expect(kinds).toContain("command");
        expect(kinds[kinds.length - 1]).toBe("stop");
        expect(events(log).at(-1)?.text).toBe("model-stopped");
        expect(events(log).some((event) => event.kind === "intent" && event.step === 1)).toBe(true);
        expect(log.join("")).not.toContain(TOKEN);
      }),
  );

  it.effect("marks a resumed start running and logs resume and routing", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? resumed() : stopped("done");
      });
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (command, args) => {
          if (command === "./ctrl") {
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
          }
          expect(command).toBe("./client");
          expect(args[0]).toBe("start");
          return { exitCode: 0, stdout: `${SESSION}\n` };
        },
        log,
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./client", "./ctrl"]);
      const lines = events(log);
      const started = lines.find((event) => event.kind === "start");
      expect(started).toMatchObject({ step: 1, kind: "start" });
      expect(started?.text.endsWith("resume routing http://127.0.0.1:9")).toBe(true);
      expect(lines.find((event) => event.kind === "running")).toEqual({
        step: 1,
        kind: "running",
        text: SESSION,
      });
      expect(userText(recorder.requests[1]?.body)).toContain(SESSION);
    }),
  );

  it.effect("a start without resume or routing is still marked running", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const log: Array<string> = [];
      yield* run(
        config(),
        recorder.layer,
        (command) => {
          if (command === "./ctrl") {
            return { exitCode: 0 };
          }
          return { exitCode: 0, stdout: `${SESSION}\n` };
        },
        log,
      );
      const lines = events(log);
      const started = lines.find((event) => event.kind === "start");
      expect(started?.text).not.toContain("resume");
      expect(started?.text).toContain("routing http://127.0.0.1:9");
      expect(lines.find((event) => event.kind === "running")?.text).toBe(SESSION);
    }),
  );

  it.effect("a start's session id is what the next guest action runs against", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        if (calls === 1) {
          return start();
        }
        if (calls === 2) {
          return sendKeys("type the password");
        }
        return stopped();
      });
      const { spawner } = yield* run(
        config(),
        recorder.layer,
        (command, args) => {
          if (command === "./ctrl") {
            return { exitCode: 0 };
          }
          if (args[0] === "start") {
            return { exitCode: 0, stdout: `${SESSION}\n` };
          }
          return { exitCode: 0, stdout: "typed\n" };
        },
        [],
        undefined,
        { id: undefined },
      );
      const typed = spawner.spawned.find((child) => child.args[0] === "send-keys");
      expect(typed?.args).toContain("--session-id");
      expect(typed?.args).toContain(SESSION);
      expect(typed?.args).toContain("--keys");
      expect(typed?.args).toContain("a");
    }),
  );

  it.effect("does not mark a machine running when start fails", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? resumed() : stopped("done");
      });
      const log: Array<string> = [];
      const { spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 1, stderr: "no reservation\n" }),
        log,
      );
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./client"]);
      expect(events(log).some((event) => event.kind === "running")).toBe(false);
      expect(userText(recorder.requests[1]?.body)).toContain("no reservation");
    }),
  );

  it.effect("a failed running mark stays in the tool result", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (command) => {
          if (command === "./ctrl") {
            return { exitCode: 1, stderr: "not pending\n" };
          }
          return { exitCode: 0, stdout: `${SESSION}\n` };
        },
        log,
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./client", "./ctrl"]);
      expect(userText(recorder.requests[1]?.body)).toContain(SESSION);
      expect(userText(recorder.requests[1]?.body)).toContain("not pending");
      expect(events(log).find((event) => event.kind === "running")?.text).toBe(SESSION);
    }),
  );

  it.effect("a missing ctrl stays in the tool result and the loop continues", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (command) => {
          if (command === "./ctrl") {
            return { spawnError: "ENOENT: no such file or directory, posix_spawn './ctrl'" };
          }
          return { exitCode: 0, stdout: `${SESSION}\n` };
        },
        [],
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./client"]);
      expect(userText(recorder.requests[1]?.body)).toContain("./ctrl");
      expect(userText(recorder.requests[1]?.body)).toContain("ENOENT");
    }),
  );

  it.effect(
    "a successful relinquish forgets the session, so the next guest action is not run",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const recorder = FakeHttp.recordRequests(() => {
          calls += 1;
          if (calls === 1) {
            return reply("continue", "give it back", { _tag: "relinquish" });
          }
          if (calls === 2) {
            return sendKeys("type");
          }
          return stopped();
        });
        const seen: Array<string> = [];
        const { stopped: outcome } = yield* run(
          config(),
          recorder.layer,
          (_command, args) => {
            seen.push(args[0] ?? "");
            return { exitCode: 0 };
          },
          [],
        );
        expect(outcome).toEqual({ reason: "model-stopped" });
        expect(seen).toEqual(["relinquish"]);
        expect(userText(recorder.requests[2]?.body)).toContain("session");
      }),
  );

  it.effect("a failed relinquish keeps the session", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        if (calls === 1) {
          return reply("continue", "give it back", { _tag: "relinquish" });
        }
        if (calls === 2) {
          return sendKeys("type");
        }
        return stopped();
      });
      const { spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) => {
          if (args[0] === "relinquish") {
            return { exitCode: 1, stderr: "no reservation\n" };
          }
          return { exitCode: 0, stdout: "typed\n" };
        },
        [],
      );
      const typed = spawner.spawned.find((child) => child.args[0] === "send-keys");
      expect(typed?.args).toContain(SESSION);
    }),
  );

  it.effect("does not intent-bracket reserve", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? reserve() : stopped("stopped");
      });
      const { spawner } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(spawner.spawned.map((child) => child.args[0])).toEqual(["reserve"]);
    }),
  );

  it.effect("closes the result when stop exits 0 and does not ask the model again", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => stop());
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) => {
          expect(args[0]).toBe("stop");
          return { exitCode: 0, stdout: "" };
        },
        log,
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(recorder.requests).toHaveLength(1);
      expect(spawner.spawned.map((child) => child.args[0])).toEqual(["stop"]);
      expect(events(log).at(-1)).toMatchObject({ kind: "stop", text: "result-closed" });
    }),
  );

  it.effect("does not run the guest command when intent start fails", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? sendKeys() : stopped("stopped");
      });
      const log: Array<string> = [];
      const { spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) => {
          expect(args[0]).toBe("intent");
          expect(args[1]).toBe("start");
          return { exitCode: 1, stderr: "Cannot start one intent when one's already running.\n" };
        },
        log,
      );
      expect(spawner.spawned).toHaveLength(1);
      expect(userText(recorder.requests[1]?.body)).toContain("already running");
      expect(userText(recorder.requests[1]?.body)).not.toContain("typed");
    }),
  );

  it.effect("closes the intent when the guest command fails to spawn", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => sendKeys("press the key"));
      const seen: Array<string> = [];
      const error = yield* Effect.flip(
        run(
          config(),
          recorder.layer,
          (_command, args) => {
            seen.push(args[0] === "intent" ? `intent ${args[1] ?? ""}` : (args[0] ?? ""));
            if (args[0] === "send-keys") {
              return { spawnError: "ENOENT: no such file or directory, posix_spawn './client'" };
            }
            return { exitCode: 0 };
          },
          [],
        ),
      );
      expect(seen).toEqual(["intent start", "send-keys", "intent end"]);
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("ENOENT");
      }
    }),
  );

  it.effect("keeps the command output when intent end fails", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? sendKeys("press the key") : stopped("stopped");
      });
      const { spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) => {
          if (args[1] === "end") {
            return { exitCode: 1, stderr: "no intent open\n" };
          }
          if (args[0] === "send-keys") {
            return { exitCode: 0, stdout: "typed\n" };
          }
          return { exitCode: 0 };
        },
        [],
      );
      expect(spawner.spawned.map((child) => child.args[0])).toEqual([
        "intent",
        "send-keys",
        "intent",
      ]);
      expect(userText(recorder.requests[1]?.body)).toContain("typed");
      expect(userText(recorder.requests[1]?.body)).toContain("no intent open");
    }),
  );

  it.effect("a long command output is clipped in the next ask", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? start() : stopped("done");
      });
      yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0, stdout: `${"x".repeat(2_000)}\n` }),
        [],
      );
      const again = userText(recorder.requests[1]?.body);
      expect(again).toContain("x".repeat(100));
      expect(again).not.toContain("x".repeat(501));
    }),
  );

  it.effect("a reply that is not one drive call fails the loop and runs nothing", () =>
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
        expect(error.message).toContain("drive");
      }
    }),
  );

  it.effect("a drive call that names a session runs nothing", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        drive({
          status: "continue",
          actionTaken: "type",
          action: { _tag: "send-keys", keys: "a", sessionId: SESSION },
        }),
      );
      const seen: Array<string> = [];
      const error = yield* Effect.flip(
        run(
          config(),
          recorder.layer,
          (_command, args) => {
            seen.push(args[0] ?? "");
            return { exitCode: 0 };
          },
          [],
        ),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("sessionId");
      }
      expect(seen).toEqual([]);
    }),
  );

  it.effect("a guest action before a session is a refusal and is not run", () =>
    Effect.gen(function* () {
      let calls = 0;
      const recorder = FakeHttp.recordRequests(() => {
        calls += 1;
        return calls === 1 ? sendKeys() : stopped();
      });
      const seen: Array<string> = [];
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        (_command, args) => {
          seen.push(args[0] ?? "");
          return { exitCode: 0 };
        },
        [],
        undefined,
        { id: undefined },
      );
      expect(outcome).toEqual({ reason: "model-stopped" });
      expect(seen).toEqual([]);
      expect(userText(recorder.requests[1]?.body)).toContain("session");
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
      expect(recorder.requests).toHaveLength(1);
      expect(events(log).at(-1)?.kind).toBe("failure");
    }),
  );

  it.effect("the run ceiling is a loop failure and names the ceiling", () =>
    Effect.gen(function* () {
      // The header timeout is shorter than the ceiling, so the wait is the guest command,
      // which is what actually runs the clock out.
      const recorder = FakeHttp.recordRequests(() => start());
      const log: Array<string> = [];
      const spawner = FakeSpawner.fakeSpawner(() => ({ stdout: "id\n" }));
      const parsed = yield* config({
        runCeiling: "2 seconds",
        header: "1 second",
        chunk: "1 second",
        defaultRetry: "100 millis",
      });
      const fiber = yield* Loop.run({
        model: MODEL,
        prompt: "Lock the screen.",
        testResultId: RESULT,
        debugLog: LOG,
        agentId: "OLI-1",
        serverUrl: "http://127.0.0.1:9",
        sessionId: SESSION,
        config: parsed,
        token: Redacted.make(TOKEN),
      }).pipe(
        Effect.provide(Layer.mergeAll(capturingFs(log), recorder.layer, spawner.layer)),
        Effect.forkScoped,
      );
      const child = yield* spawner.nextSpawn;
      yield* TestClock.setTime(2_000);
      yield* child.exit(0);
      const marked = yield* spawner.nextSpawn;
      yield* marked.exit(0);
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("run ceiling");
      }
      expect(recorder.requests).toHaveLength(1);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  it.effect("a missing client is a loop failure and names the command", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => start());
      const log: Array<string> = [];
      const error = yield* Effect.flip(
        run(
          config(),
          recorder.layer,
          () => ({ spawnError: "ENOENT: no such file or directory, posix_spawn './client'" }),
          log,
        ),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("./client");
        expect(error.message).toContain("ENOENT");
      }
    }),
  );

  it.effect("a debug log that cannot be written fails the loop", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => stopped("done"));
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], Effect.fail(denied)),
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
