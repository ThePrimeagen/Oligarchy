import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import * as NodePath from "@effect/platform-node/NodePath";
import {
  Cause,
  Console,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  PlatformError,
  Redacted,
} from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import * as DbErrors from "@oligarchy/db/errors";
import * as DbSchema from "@oligarchy/db/schema";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as Oligarchy from "@oligarchy/env/oligarchy";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as TestingHttp from "@oligarchy/testing/http-client";
import * as TestingStores from "@oligarchy/testing/stores";
import * as DriverLog from "../../src/driver/log.ts";
import * as Loop from "../../src/driver/loop.ts";
import * as TestingSpawner from "@oligarchy/testing/spawner";

const TOKEN = "super-secret-token";
const MODEL = "openrouter/test-model";
const RESULT = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";
const ISO = "https://example.com/omarchy.iso";
const SERVER = "http://127.0.0.1:9";
const LOG = "/tmp/driver-debug.log";

type DefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;
type RunRow = typeof DbSchema.testRuns.$inferSelect;
type ResultRow = typeof DbSchema.testResults.$inferSelect;

type Seed = {
  readonly instruction: string;
  readonly proof: string;
  readonly name: string;
  readonly iso: string;
  readonly serverUrl: string;
  readonly linearId: string;
};

const config = (overrides?: {
  readonly stepLimit?: number;
  readonly runCeiling?: string;
  readonly header?: string;
  readonly chunk?: string;
  readonly defaultRetry?: string;
}) =>
  Oligarchy.parse(
    JSON.stringify({
      models: { drive: MODEL, diagnose: MODEL, mint: MODEL },
      reasoning: { drive: "minimal", diagnose: "minimal", mint: "minimal" },
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

const client = (reason: string, args: ReadonlyArray<string>, step = 1): Response =>
  call({ name: "client", arguments: { step, reason, args } });

const done = (): Response => call({ name: "Done", arguments: {} });

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

const speak = (did: string, action: string, step = 1): Response =>
  client(did, tokens(action), step);

const sendKeys = (did: string | null = "lock the screen", step = 1) =>
  speak(did ?? "send-keys", "send-keys --keys a", step);

const notACall = (): Response =>
  sse([
    frame({ choices: [{ delta: { content: "hello" }, finish_reason: null }] }),
    frame({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "[DONE]",
  ]);

const answers = (...replies: ReadonlyArray<Response>) => {
  let calls = 0;
  return () => {
    const reply = replies[calls] ?? replies[replies.length - 1];
    calls += 1;
    return reply ?? done();
  };
};

const intentCall = () => speak("bad", "intent start --message lock");

const isModel = (url: URL): boolean => url.origin === "https://openrouter.ai";

const routed = (
  model: () => Response,
  guest: (url: URL) => Response = (url) =>
    url.pathname === "/start"
      ? TestingHttp.json({ id: SESSION })
      : TestingHttp.json({ ok: "true" }),
) => TestingHttp.recordRequests((_request, url) => (isModel(url) ? model() : guest(url)));

const modelRequests = (
  requests: ReadonlyArray<TestingHttp.Recorded>,
): ReadonlyArray<TestingHttp.Recorded> =>
  requests.filter((request) => isModel(new URL(request.url)));

const guestRequests = (
  requests: ReadonlyArray<TestingHttp.Recorded>,
): ReadonlyArray<TestingHttp.Recorded> =>
  requests.filter((request) => !isModel(new URL(request.url)));

const guestPaths = (requests: ReadonlyArray<TestingHttp.Recorded>): ReadonlyArray<string> =>
  guestRequests(requests).map((request) => new URL(request.url).pathname);

const askText = (requests: ReadonlyArray<TestingHttp.Recorded>, index: number): string =>
  userText(modelRequests(requests)[index]?.body);

const past = (requests: ReadonlyArray<TestingHttp.Recorded>, index: number): string =>
  reasons(modelRequests(requests)[index]?.body);

type Script = TestingSpawner.Script;

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

const printing = (into: Array<string>): Console.Console =>
  Object.assign(Object.create(console), {
    log: (...args: ReadonlyArray<unknown>) => {
      into.push(args.map(String).join(" "));
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
    if (!fields(message) || message.role !== role) {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (fields(part) && part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
      }
    }
  }
  return "";
};

const userText = (body: string | undefined): string => messageText(body, "user");

const userImages = (body: string | undefined): ReadonlyArray<string> => {
  const value: unknown = JSON.parse(body ?? "{}");
  if (!fields(value) || !Array.isArray(value.messages)) {
    return [];
  }
  const urls: Array<string> = [];
  for (const message of value.messages) {
    if (!fields(message) || message.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (
        fields(part) &&
        part.type === "image_url" &&
        fields(part.image_url) &&
        typeof part.image_url.url === "string"
      ) {
        urls.push(part.image_url.url);
      }
    }
  }
  return urls;
};

const imagesAt = (requests: ReadonlyArray<TestingHttp.Recorded>, index: number) =>
  userImages(modelRequests(requests)[index]?.body);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xff]);
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

const screenshot = (): Response =>
  new Response(PNG, {
    status: 200,
    headers: { "content-type": "image/png", "x-image-url": "https://example.com/images/1" },
  });

const withScreen =
  (image: () => Response = screenshot) =>
  (url: URL): Response => {
    if (url.pathname === "/start") {
      return TestingHttp.json({ id: SESSION });
    }
    return url.pathname === "/image" ? image() : TestingHttp.json({ ok: "true" });
  };

const getImage = () => speak("look at the screen", "get-image");

const systemText = (body: string | undefined): string => messageText(body, "system");

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

const seedOf = (agentId: string, patch?: Partial<Seed>): Seed => ({
  instruction: "Lock the screen.",
  proof: "none",
  name: "lock-screen",
  iso: ISO,
  serverUrl: SERVER,
  linearId: agentId,
  ...patch,
});

const definitionRow = (seed: Seed): DefinitionRow => ({
  id: 1,
  name: seed.name,
  description: "the lock screen",
  instruction: seed.instruction,
  proof: seed.proof,
  createdAt: new Date(0),
});

const runRow = (seed: Seed): RunRow => ({
  id: RUN_ID,
  name: "Omarchy experiment",
  iso: seed.iso,
  serverUrl: seed.serverUrl,
  status: "pending",
  reason: null,
  startedAt: new Date(0),
  endedAt: null,
});

const resultRow = (seed: Seed, definitionId: number): ResultRow => ({
  id: RESULT,
  runId: RUN_ID,
  definitionId,
  sessionId: null,
  model: null,
  linearId: seed.linearId,
  status: "pending",
  reason: null,
  createdAt: new Date(0),
  finishedAt: null,
});

type StoreMode = "present" | "missing" | "no-definition";

const storeFor = (
  mode: StoreMode,
  seed: Seed,
  overrides?: Partial<typeof Tests.TestStore.Service>,
) => {
  if (mode === "missing") {
    return TestingStores.fakeTestStore({}, overrides);
  }
  return TestingStores.fakeTestStore(
    {
      definitions: mode === "no-definition" ? [] : [definitionRow(seed)],
      runs: [runRow(seed)],
      results: [resultRow(seed, mode === "no-definition" ? 99 : 1)],
    },
    overrides,
  );
};

const run = (
  app: Effect.Effect<Oligarchy.AppConfig, SharedErrors.CommandError>,
  http: Layer.Layer<HttpClient.HttpClient>,
  script: Script,
  log: Array<string>,
  options?: {
    readonly write?: Effect.Effect<void, PlatformError.PlatformError>;
    readonly env?: Config.Values;
    readonly prompt?: string;
    readonly agentId?: string;
    readonly seed?: Partial<Seed>;
    readonly mode?: StoreMode;
    readonly overrides?: Partial<typeof Tests.TestStore.Service>;
    readonly printed?: Array<string>;
    readonly reasoning?: Oligarchy.Effort;
  },
) =>
  Effect.gen(function* () {
    const parsed = yield* app;
    const spawner = TestingSpawner.fakeSpawner(script);
    const agentId = options?.agentId ?? "OLI-1";
    const prompt = options?.prompt ?? "Lock the screen.";
    const store = storeFor(
      options?.mode ?? "present",
      seedOf(agentId, options?.seed),
      options?.overrides,
    );
    const printed = options?.printed ?? [];
    const stoppedRun = yield* Loop.run({
      model: MODEL,
      prompt,
      agentId,
      debugLog: LOG,
      config: parsed,
      token: Redacted.make(TOKEN),
      reasoning: options?.reasoning ?? "minimal",
    }).pipe(
      Effect.provideService(Console.Console, printing(printed)),
      Effect.provide(
        Layer.mergeAll(
          capturingFs(log, options?.write),
          http,
          spawner.layer,
          NodePath.layer,
          Config.fromValues(options?.env ?? { OLIGARCHY_TOKEN: TOKEN }),
          store.layer,
        ),
      ),
    );
    return { stopped: stoppedRun, spawner, log, printed };
  });

describe("driver loop", () => {
  it.effect("an unknown ticket fails before start and does not invent a definition (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], { mode: "missing" }),
      );
      expect(error).toMatchObject({ _tag: "CommandError", message: "no result for OLI-1" });
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect("a ticket whose definition is gone fails before start (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], { mode: "no-definition" }),
      );
      expect(error).toMatchObject({ _tag: "CommandError", message: "no definition for OLI-1" });
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect("a database error looking up the ticket fails before start (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
          overrides: {
            findResultByLinearId: () =>
              Effect.fail(
                DbErrors.DatabaseError.make({
                  operation: "findResultByLinearId",
                  message: "Failed query: select",
                  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
                }),
              ),
          },
        }),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("Failed query");
      }
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect(
    "looks the run up from the agent id, starts it resumed, drives one action, and stops",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(
            speak(
              "lock the screen",
              "send-keys --agent-id WRONG --session-id bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb --server-url http://stolen.example --keys a",
            ),
            done(),
          ),
        );
        const log: Array<string> = [];
        const { stopped: outcome, spawner } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
          {
            seed: {
              instruction: "Lock it from the menu.",
              proof: "The screen is locked.",
            },
            prompt: "<instruction>not this</instruction><proof>not this either</proof>",
          },
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl", "./ctrl"]);
        expect(spawner.spawned[0]?.args).toEqual([
          "test",
          "start",
          "--session-id",
          SESSION,
          "--test-result-id",
          RESULT,
          "--model",
          MODEL,
        ]);
        expect(spawner.spawned[1]?.args).toEqual([
          "test-results",
          "--agent-id",
          "OLI-1",
          "--id",
          RESULT,
          "--status",
          "success",
        ]);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/stop",
        ]);
        expect(JSON.parse(guestRequests(recorder.requests)[0]?.body ?? "{}")).toEqual({
          iso: ISO,
          agent: "OLI-1",
          mode: "resume",
        });
        expect(guestRequests(recorder.requests)[0]?.url.startsWith(`${SERVER}/start`)).toBe(true);
        const opened = guestRequests(recorder.requests)[1];
        expect(JSON.parse(opened?.body ?? "{}")).toEqual({
          id: SESSION,
          agent: "OLI-1",
          test_result_id: RESULT,
          message: "step 1",
        });
        expect(opened?.url.startsWith(`${SERVER}/intent/start`)).toBe(true);
        expect(JSON.parse(guestRequests(recorder.requests)[2]?.body ?? "{}")).toMatchObject({
          id: SESSION,
          agent: "OLI-1",
          keys: "a",
        });
        expect(guestRequests(recorder.requests)[2]?.url).not.toContain("stolen.example");
        expect(JSON.parse(guestRequests(recorder.requests)[3]?.body ?? "{}")).toMatchObject({
          id: SESSION,
          agent: "OLI-1",
          status: "succeeded",
        });

        expect(modelRequests(recorder.requests)).toHaveLength(2);
        const system = systemText(modelRequests(recorder.requests)[0]?.body);
        expect(system).toContain("<def>\nLock it from the menu.\n</def>");
        expect(system).toContain("<proof>\nThe screen is locked.\n</proof>");
        expect(system).not.toContain("not this");
        expect(system).toContain("Past steps:\nnone");
        expect(system).not.toContain("{{");
        expect(askText(recorder.requests, 0)).toBe(
          "<instruction>not this</instruction><proof>not this either</proof>",
        );
        expect(past(recorder.requests, 1)).toContain("step 1: lock the screen");
        expect(past(recorder.requests, 0)).not.toContain(SESSION);

        const started = events(log).find((event) => event.kind === "start");
        expect(started).toMatchObject({ step: 0, kind: "start" });
        expect(started?.text.endsWith(`resume routing ${SERVER}`)).toBe(true);
        expect(events(log).find((event) => event.kind === "running")).toEqual({
          step: 0,
          kind: "running",
          text: SESSION,
        });
        expect(events(log).find((event) => event.kind === "intent")).toEqual({
          step: 0,
          kind: "intent",
          text: "step 1",
        });
        expect(events(log).at(-1)).toMatchObject({ kind: "stop", text: "result-closed" });
        expect(log.join("")).not.toContain(TOKEN);
      }),
  );

  it.effect("a mint with no stored server starts fresh, then save closes the result", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        log,
        { seed: { name: "mint", serverUrl: "" } },
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(JSON.parse(guestRequests(recorder.requests)[0]?.body ?? "{}")).toEqual({
        iso: ISO,
        agent: "OLI-1",
      });
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/save"]);
      expect(spawner.spawned[1]?.args).toContain("success");
      const started = events(log).find((event) => event.kind === "start");
      expect(started?.text).not.toContain("resume");
      expect(started?.text).not.toContain("routing");
    }),
  );

  it.effect("a start that does not boot fails the loop and does not ask the model (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()), () =>
        TestingHttp.json({ error: "no reservation" }, 400),
      );
      const log: Array<string> = [];
      const error = yield* Effect.flip(run(config(), recorder.layer, () => ({ exitCode: 0 }), log));
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("no reservation");
      }
      expect(modelRequests(recorder.requests)).toEqual([]);
      expect(guestPaths(recorder.requests)).toEqual(["/start"]);
      expect(events(log).some((event) => event.kind === "running")).toBe(false);
    }),
  );

  it.effect("a failed running mark stays in the first ask and the loop still stops", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const log: Array<string> = [];
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) =>
          args[0] === "test" ? { exitCode: 1, stderr: "not pending\n" } : { exitCode: 0 },
        log,
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl", "./ctrl"]);
      expect(past(recorder.requests, 0)).toContain("not pending");
      expect(events(log).find((event) => event.kind === "running")?.text).toBe(SESSION);
    }),
  );

  it.effect("a missing ctrl stays in the first ask and the loop still stops", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const { stopped: outcome, spawner } = yield* run(
        config(),
        recorder.layer,
        (_command, args) =>
          args[0] === "test"
            ? { spawnError: "ENOENT: no such file or directory, posix_spawn './ctrl'" }
            : { exitCode: 0 },
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl"]);
      expect(past(recorder.requests, 0)).toContain("./ctrl");
      expect(past(recorder.requests, 0)).toContain("ENOENT");
    }),
  );

  it.effect("a model start or stop is refused; the harness owns both (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(speak("boot", "start --resume"), speak("halt", "stop --status failed"), done()),
      );
      const log: Array<string> = [];
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        log,
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(JSON.parse(guestRequests(recorder.requests)[2]?.body ?? "{}")).toMatchObject({
        status: "succeeded",
      });
      expect(past(recorder.requests, 1)).toContain("the harness starts and stops");
      expect(past(recorder.requests, 2)).toContain("the harness starts and stops");
      expect(events(log).some((event) => event.kind === "refusal")).toBe(true);
    }),
  );

  it.effect("does not intent a refused intent call", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(intentCall(), done()));
      const log: Array<string> = [];
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(events(log).some((event) => event.kind === "refusal")).toBe(true);
      expect(past(recorder.requests, 1)).toContain("intent");
    }),
  );

  it.effect(
    "a test-results failure is a loop failure and does not ask the model again (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(done()));
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 1, stderr: "result is aborted\n" }), []),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain("aborted");
        }
        expect(modelRequests(recorder.requests)).toHaveLength(1);
      }),
  );

  it.effect(
    "a step whose intent will not open runs no guest action, and its failure is in every ask (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(sendKeys(null), done()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          return url.pathname === "/intent/start"
            ? TestingHttp.json(
                { error: "Cannot start one intent when one's already running." },
                400,
              )
            : TestingHttp.json({ ok: "true" });
        });
        const { spawner } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
        expect(spawner.spawned.map((child) => child.command)).toEqual(["./ctrl", "./ctrl"]);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/intent/start",
          "/stop",
        ]);
        expect(past(recorder.requests, 0)).toContain("already running");
        expect(past(recorder.requests, 1)).toContain("step 1: send-keys");
      }),
  );

  it.effect(
    "a failed guest command keeps its step's intent open for the next action (unhappy)",
    () =>
      Effect.gen(function* () {
        let presses = 0;
        const recorder = routed(
          answers(sendKeys("press the key", 1), sendKeys("press it again", 1), done()),
          (url) => {
            if (url.pathname === "/start") {
              return TestingHttp.json({ id: SESSION });
            }
            if (url.pathname === "/send-keys") {
              presses += 1;
              return presses === 1
                ? TestingHttp.json({ error: "keys refused" }, 400)
                : TestingHttp.json({ ok: "true" });
            }
            return TestingHttp.json({ ok: "true" });
          },
        );
        const { stopped: outcome } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          [],
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/send-keys",
          "/stop",
        ]);
        expect(past(recorder.requests, 1)).toContain("keys refused");
      }),
  );

  it.effect(
    "an intent end that fails at a step change stays in the next ask, and the new step still opens (unhappy)",
    () =>
      Effect.gen(function* () {
        let ends = 0;
        const recorder = routed(
          answers(sendKeys("press the key", 1), sendKeys("look again", 2), done()),
          (url) => {
            if (url.pathname === "/start") {
              return TestingHttp.json({ id: SESSION });
            }
            if (url.pathname === "/intent/end") {
              ends += 1;
              return ends === 1
                ? TestingHttp.json({ error: "no intent open" }, 400)
                : TestingHttp.json({ ok: "true" });
            }
            return TestingHttp.json({ ok: "true" });
          },
        );
        const { stopped: outcome } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          [],
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/intent/end",
          "/intent/start",
          "/send-keys",
          "/stop",
        ]);
        expect(past(recorder.requests, 2)).toContain("intent end failed");
        expect(past(recorder.requests, 2)).toContain("no intent open");
        expect(past(recorder.requests, 2)).toContain("step 2: look again");
      }),
  );

  it.effect(
    "step 1 opens with the first ActionList line; only a new step ends it and opens the next line; Done leaves the last to the stop",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(
            sendKeys("open the menu", 1),
            sendKeys("click lock", 1),
            sendKeys("check it locked", 2),
            done(),
          ),
        );
        const log: Array<string> = [];
        const { stopped: outcome } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
          {
            seed: {
              instruction:
                "<ActionList>\n* Open the menu and click Lock.\n* Check the screen is locked.\n* any crashes or erroneous behavior must be reported\n</ActionList>",
            },
          },
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/send-keys",
          "/intent/end",
          "/intent/start",
          "/send-keys",
          "/stop",
        ]);
        expect(JSON.parse(guestRequests(recorder.requests)[1]?.body ?? "{}")).toMatchObject({
          message: "Open the menu and click Lock.",
        });
        expect(JSON.parse(guestRequests(recorder.requests)[5]?.body ?? "{}")).toMatchObject({
          message: "Check the screen is locked.",
        });
        expect(modelRequests(recorder.requests)).toHaveLength(4);
        const opened = events(log).findIndex((event) => event.kind === "intent");
        const asked = events(log).findIndex((event) => event.kind === "request");
        expect(opened).toBeGreaterThan(-1);
        expect(opened).toBeLessThan(asked);
        const steps = past(recorder.requests, 3);
        expect(steps).toContain("step 1: open the menu");
        expect(steps).toContain("step 1: click lock");
        expect(steps).toContain("step 2: check it locked");
      }),
  );

  it.effect("a step past the ActionList opens an intent named by its number (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys("open it", 1), sendKeys("look past it", 2), done()));
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
        seed: { instruction: "<ActionList>\n* Open the menu.\n</ActionList>" },
      });
      expect(JSON.parse(guestRequests(recorder.requests)[1]?.body ?? "{}")).toMatchObject({
        message: "Open the menu.",
      });
      expect(JSON.parse(guestRequests(recorder.requests)[4]?.body ?? "{}")).toMatchObject({
        message: "step 2",
      });
    }),
  );

  it.effect(
    "opens and ends step intents by calling the client's intent functions; no ./client line is built for them",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(sendKeys("open it", 1), sendKeys("check it", 2), done()));
        const log: Array<string> = [];
        yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/intent/end",
          "/intent/start",
          "/send-keys",
          "/stop",
        ]);
        const commands = events(log)
          .filter((event) => event.kind === "command")
          .map((event) => event.text);
        expect(commands.some((text) => text.includes('"intent"'))).toBe(false);
        expect(commands.filter((text) => text === "intent start ok")).toHaveLength(2);
        expect(commands.filter((text) => text === "intent end ok")).toHaveLength(1);
      }),
  );

  it.effect(
    "a run with no stored server opens its intents on SERVER_URL, the server start used",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(done()));
        yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
          seed: { serverUrl: "" },
          env: { OLIGARCHY_TOKEN: TOKEN, SERVER_URL: "http://10.9.9.9:4" },
        });
        const [started, opened] = guestRequests(recorder.requests);
        expect(started?.url.startsWith("http://10.9.9.9:4/start")).toBe(true);
        expect(opened?.url.startsWith("http://10.9.9.9:4/intent/start")).toBe(true);
      }),
  );

  it.effect(
    "an unreachable server on intent start runs no action and puts the failure in the next ask (unhappy)",
    () =>
      Effect.gen(function* () {
        const model = answers(sendKeys("press the key", 1), done());
        const recorder = TestingHttp.recordRequests((request, url) => {
          if (isModel(url)) {
            return model();
          }
          if (url.pathname === "/intent/start") {
            return Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  cause: new Error("connect ECONNREFUSED 127.0.0.1:9"),
                }),
              }),
            );
          }
          return url.pathname === "/start"
            ? TestingHttp.json({ id: SESSION })
            : TestingHttp.json({ ok: "true" });
        });
        const log: Array<string> = [];
        const { stopped: outcome } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/intent/start",
          "/stop",
        ]);
        expect(past(recorder.requests, 0)).toContain("ECONNREFUSED");
        expect(past(recorder.requests, 1)).toContain("step 1: press the key");
        expect(log.join("")).not.toContain(TOKEN);
      }),
  );

  it.effect(
    "a run that ends failed with a step's intent open sends no intent end; the stop cancels it (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(sendKeys("press the key", 1), notACall(), notACall(), notACall()),
        );
        const { stopped } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
        expect(stopped).toEqual({ reason: "limit-reached" });
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/send-keys",
          "/stop",
        ]);
        expect(JSON.parse(guestRequests(recorder.requests)[3]?.body ?? "{}")).toMatchObject({
          status: "failed",
        });
      }),
  );

  it.effect(
    "step 1's intent that fails to open is opened by that step's next action, and later actions share it (unhappy)",
    () =>
      Effect.gen(function* () {
        let opens = 0;
        const recorder = routed(
          answers(sendKeys("open the menu"), sendKeys("open the menu"), done()),
          (url) => {
            if (url.pathname === "/start") {
              return TestingHttp.json({ id: SESSION });
            }
            if (url.pathname === "/intent/start") {
              opens += 1;
              return opens === 1
                ? TestingHttp.json({ error: "intent refused" }, 400)
                : TestingHttp.json({ ok: "true" });
            }
            return TestingHttp.json({ ok: "true" });
          },
        );
        yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/intent/start",
          "/send-keys",
          "/send-keys",
          "/stop",
        ]);
        expect(past(recorder.requests, 0)).toContain("intent refused");
      }),
  );

  it.effect("a long command output is clipped in the next ask", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys(), done()), (url) => {
        if (url.pathname === "/start") {
          return TestingHttp.json({ id: SESSION });
        }
        return url.pathname === "/send-keys"
          ? TestingHttp.json({ error: "x".repeat(2_000) }, 400)
          : TestingHttp.json({ ok: "true" });
      });
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      const again = past(recorder.requests, 1);
      expect(again).toContain("x".repeat(100));
      expect(again).not.toContain("x".repeat(501));
      expect(askText(recorder.requests, 1)).toBe("Lock the screen.");
    }),
  );

  it.effect(
    "a failed stop on a failed run still closes the result and keeps the original error (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          () =>
            new Response(JSON.stringify({ error: { message: "no credits" } }), {
              status: 402,
              headers: { "content-type": "application/json" },
            }),
          (url) => {
            if (url.pathname === "/start") {
              return TestingHttp.json({ id: SESSION });
            }
            return url.pathname === "/stop"
              ? TestingHttp.json({ error: "guest already gone" }, 400)
              : TestingHttp.json({ ok: "true" });
          },
        );
        const log: Array<string> = [];
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 0 }), log),
        );
        expect(error).toMatchObject({ _tag: "OpenRouterRefusal", message: "no credits" });
        expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
        expect(log.join("")).toContain("test-results");
        expect(log.join("")).toContain("--status");
        expect(log.join("")).toContain("failed");
        expect(log.join("")).toContain("stop:");
        expect(log.join("")).toContain("guest already gone");
      }),
  );

  it.effect("an interrupt after the session starts still stops it", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const log: Array<string> = [];
      const spawner = TestingSpawner.fakeSpawner((_command, args) =>
        args[0] === "test-results" ? { exitCode: 0 } : {},
      );
      const parsed = yield* config();
      const store = storeFor("present", seedOf("OLI-1"));
      const fiber = yield* Loop.run({
        model: MODEL,
        prompt: "Lock the screen.",
        agentId: "OLI-1",
        debugLog: LOG,
        config: parsed,
        token: Redacted.make(TOKEN),
        reasoning: "minimal",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            capturingFs(log),
            recorder.layer,
            spawner.layer,
            NodePath.layer,
            Config.fromValues({ OLIGARCHY_TOKEN: TOKEN }),
            store.layer,
          ),
        ),
        Effect.forkScoped,
      );
      yield* spawner.nextSpawn;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/stop"]);
      expect(log.join("")).toContain("test-results");
      expect(log.join("")).toContain("failed");
      expect(log.join("")).toContain("session-stopped");
    }),
  );

  it.effect(
    "three replies in a row that are not one tool call fail the test, name the replies, and stop the session (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(notACall);
        const log: Array<string> = [];
        const { stopped } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
        expect(stopped).toEqual({ reason: "limit-reached" });
        const failure = events(log).find((event) => event.kind === "failure");
        expect(failure?.text).toContain("model could not respond correctly");
        expect(failure?.text).toContain("3 bad replies in a row");
        expect(failure?.text).toContain("reply:");
        expect(failure?.text).toContain("hello");
        expect(modelRequests(recorder.requests)).toHaveLength(3);
        expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
        expect(JSON.parse(guestRequests(recorder.requests)[2]?.body ?? "{}")).toMatchObject({
          status: "failed",
          reason: expect.stringContaining("model could not respond correctly"),
        });
        const closed = events(log).find(
          (event) => event.kind === "command" && event.text.startsWith('./ctrl "test-results"'),
        );
        expect(closed?.text).toContain('"failed"');
        expect(closed?.text).toContain("model could not respond correctly");
      }),
  );

  it.effect(
    "a mint whose model sends three bad replies stops failed and never saves (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(notACall);
        const { stopped, spawner } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          [],
          {
            seed: { name: "mint", serverUrl: "" },
          },
        );
        expect(stopped).toEqual({ reason: "limit-reached" });
        const paths = guestPaths(recorder.requests);
        expect(paths).not.toContain("/save");
        expect(paths.at(-1)).toBe("/stop");
        expect(spawner.spawned.at(-1)?.args).toEqual(
          expect.arrayContaining(["--status", "failed"]),
        );
      }),
  );

  it.effect(
    "three bad replies whose result will not close are still the run's failure (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(notACall);
        const error = yield* Effect.flip(
          run(
            config(),
            recorder.layer,
            (_command, args) =>
              args[0] === "test-results"
                ? { exitCode: 1, stderr: "database unreachable" }
                : { exitCode: 0 },
            [],
          ),
        );
        expect(error._tag).toBe("CommandError");
        expect(guestPaths(recorder.requests)).toContain("/stop");
      }),
  );

  it.effect("a reply that is not JSON is refused into the next ask and the model asks again", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(notACall(), done()));
      const log: Array<string> = [];
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        log,
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(modelRequests(recorder.requests)).toHaveLength(2);
      expect(past(recorder.requests, 1)).toContain("reply refused");
      expect(past(recorder.requests, 1)).toContain("hello");
      expect(events(log).some((event) => event.kind === "refusal")).toBe(true);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
    }),
  );

  it.effect("each ask after the first shows the model the reply it gave last", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys("press a"), done()));
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      const asks = modelRequests(recorder.requests);
      expect(systemText(asks[0]?.body)).not.toContain("Your last response was");
      expect(systemText(asks[1]?.body)).toContain(
        `Your last response was\n<tool-call>\n${JSON.stringify({
          name: "client",
          arguments: { step: 1, reason: "press a", args: ["send-keys", "--keys", "a"] },
        })}\n</tool-call>`,
      );
    }),
  );

  it.effect("the ask after a reply that is not JSON shows the model that reply (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(notACall(), done()));
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(systemText(modelRequests(recorder.requests)[1]?.body)).toContain(
        "Your last response was\n<tool-call>\nhello\n</tool-call>",
      );
    }),
  );

  it.effect("a command that runs between bad replies starts the count of three again", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(notACall(), notACall(), sendKeys(), notACall(), notACall(), done()),
      );
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(modelRequests(recorder.requests)).toHaveLength(6);
      expect(guestPaths(recorder.requests)).toEqual([
        "/start",
        "/intent/start",
        "/send-keys",
        "/stop",
      ]);
    }),
  );

  it.effect("a command the guest refuses is a correct reply and starts the count again", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(notACall(), notACall(), sendKeys(), notACall(), notACall(), done()),
        (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          return url.pathname === "/send-keys"
            ? TestingHttp.json({ error: "keyboard is busy" }, 409)
            : TestingHttp.json({ ok: "true" });
        },
      );
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(modelRequests(recorder.requests)).toHaveLength(6);
      expect(past(recorder.requests, 3)).toContain("keyboard is busy");
    }),
  );

  it.effect("three refused commands in a row fail the test and name each refusal (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(speak("boot", "start --resume"), intentCall(), speak("halt", "stop")),
      );
      const log: Array<string> = [];
      const { stopped } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
      expect(stopped).toEqual({ reason: "limit-reached" });
      const failure = events(log).find((event) => event.kind === "failure")?.text;
      expect(failure).toContain("model could not respond correctly");
      expect(failure).toContain("the harness starts and stops the session");
      expect(failure).toContain("the harness opens and closes intents");
      expect(modelRequests(recorder.requests)).toHaveLength(3);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
    }),
  );

  it.effect(
    "an unknown action and an unknown flag count toward the three with a reply that is not JSON (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(notACall(), speak("spin", "frobnicate"), speak("press", "send-keys --nope")),
        );
        const log: Array<string> = [];
        const { stopped } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), log);
        expect(stopped).toEqual({ reason: "limit-reached" });
        const failure = events(log).find((event) => event.kind === "failure")?.text;
        expect(failure).toContain("model could not respond correctly");
        expect(failure).toContain("hello");
        expect(failure).toContain("unknown action frobnicate");
        expect(failure).toContain("unknown flag --nope");
        expect(modelRequests(recorder.requests)).toHaveLength(3);
        expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      }),
  );

  it.effect("a refused OpenRouter request exits with the reason and stops the session", () =>
    Effect.gen(function* () {
      const recorder = routed(
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
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(
        events(log).some((event) => event.kind === "failure" && event.text.includes("no credits")),
      ).toBe(true);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  it.effect("an unreachable OpenRouter is a loop failure and stops the session", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests((request, url) => {
        if (isModel(url)) {
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                cause: new Error("connect ECONNREFUSED 127.0.0.1:443"),
              }),
            }),
          );
        }
        return url.pathname === "/start"
          ? TestingHttp.json({ id: SESSION })
          : TestingHttp.json({ ok: "true" });
      });
      const log: Array<string> = [];
      const error = yield* Effect.flip(run(config(), recorder.layer, () => ({ exitCode: 0 }), log));
      expect(error._tag).toBe("OpenRouterUnreachable");
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(events(log).some((event) => event.kind === "failure")).toBe(true);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  // The model ran out of steps: that is the test's verdict, not the system failing. The guest
  // stops failed, the result closes failed with the reason, and the drive ends so it is judged.
  it.effect("the step limit fails the test: the guest stops failed, the result closes failed", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys()));
      const closed: Array<ReadonlyArray<string>> = [];
      const log: Array<string> = [];
      const ran = yield* run(
        config({ stepLimit: 1 }),
        recorder.layer,
        (_command, args) => {
          if (args[0] === "test-results") {
            closed.push(args);
          }
          return { exitCode: 0 };
        },
        log,
      );
      expect(ran.stopped).toEqual({ reason: "limit-reached" });
      expect(modelRequests(recorder.requests)).toHaveLength(1);
      const paths = guestPaths(recorder.requests);
      expect(paths.at(-1)).toBe("/stop");
      expect(JSON.parse(guestRequests(recorder.requests).at(-1)?.body ?? "{}")).toMatchObject({
        status: "failed",
        reason: "step limit of 1 reached",
      });
      expect(closed).toHaveLength(1);
      expect(closed[0]).toEqual(
        expect.arrayContaining(["--status", "failed", "--reason", "step limit of 1 reached"]),
      );
      expect(events(log).some((event) => event.kind === "failure")).toBe(true);
    }),
  );

  it.effect("a mint that hits the step limit stops failed and never saves the disk", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys()));
      const { stopped, spawner } = yield* run(
        config({ stepLimit: 1 }),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
        { seed: { name: "mint", serverUrl: "" } },
      );
      expect(stopped).toEqual({ reason: "limit-reached" });
      const paths = guestPaths(recorder.requests);
      expect(paths).not.toContain("/save");
      expect(paths.at(-1)).toBe("/stop");
      expect(spawner.spawned.at(-1)?.args).toEqual(
        expect.arrayContaining(["--status", "failed", "--reason", "step limit of 1 reached"]),
      );
    }),
  );

  it.effect("a step limit whose result will not close is still the run's failure (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys()));
      const error = yield* Effect.flip(
        run(
          config({ stepLimit: 1 }),
          recorder.layer,
          (_command, args) =>
            args[0] === "test-results"
              ? { exitCode: 1, stderr: "database unreachable" }
              : { exitCode: 0 },
          [],
        ),
      );
      expect(error._tag).toBe("CommandError");
      expect(guestPaths(recorder.requests)).toContain("/stop");
    }),
  );

  it.effect("the run ceiling fails the test the same way and names the ceiling", () =>
    Effect.gen(function* () {
      // Start returns at once. The clock moves while ./ctrl test start is still running,
      // so the model is never asked, and the harness still stops the session it opened.
      const recorder = routed(answers(done()));
      const log: Array<string> = [];
      const spawner = TestingSpawner.fakeSpawner((_command, args) =>
        args[0] === "test-results" ? { exitCode: 0 } : {},
      );
      const parsed = yield* config({
        runCeiling: "2 seconds",
        header: "1 second",
        chunk: "1 second",
        defaultRetry: "100 millis",
      });
      const store = storeFor("present", seedOf("OLI-1"));
      const fiber = yield* Loop.run({
        model: MODEL,
        prompt: "Lock the screen.",
        agentId: "OLI-1",
        debugLog: LOG,
        config: parsed,
        token: Redacted.make(TOKEN),
        reasoning: "minimal",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            capturingFs(log),
            recorder.layer,
            spawner.layer,
            NodePath.layer,
            Config.fromValues({ OLIGARCHY_TOKEN: TOKEN }),
            store.layer,
          ),
        ),
        Effect.forkScoped,
      );
      const marked = yield* spawner.nextSpawn;
      yield* TestClock.setTime(2_000);
      yield* marked.exit(0);
      expect(yield* Fiber.join(fiber)).toEqual({ reason: "limit-reached" });
      expect(JSON.parse(guestRequests(recorder.requests).at(-1)?.body ?? "{}").reason).toContain(
        "run ceiling",
      );
      expect(modelRequests(recorder.requests)).toHaveLength(0);
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(log.join("")).not.toContain(TOKEN);
    }),
  );

  it.effect("a missing token fails the harness start and does not ask the model (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], { env: {} }),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain("OLIGARCHY_TOKEN is not set");
      }
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect("an unknown flag is the action's failure and the loop continues", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(speak("press", "send-keys --nope"), done()));
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(past(recorder.requests, 1)).toContain("--nope");
    }),
  );

  it.effect("a ./client-with-image action is an unknown command and takes no screenshot", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(
          speak(
            "lock the screen",
            `./client-with-image send-keys --agent-id OLI-1 --session-id ${SESSION} --server-url ${SERVER} --keys a`,
          ),
          done(),
        ),
      );
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      expect(past(recorder.requests, 1)).toContain("./client-with-image");
    }),
  );

  it.effect("every model request carries the reasoning effort it was given", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys("press a"), done()));
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), [], { reasoning: "high" });
      const bodies = modelRequests(recorder.requests).map((request) => JSON.parse(request.body));
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.reasoning).toEqual({ effort: "high" });
      }
    }),
  );

  it.effect("prints each model request, reply, and command to stdout under the ticket", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(sendKeys("press a"), done()));
      const { printed } = yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
        agentId: "OLIT-7",
      });
      expect(printed).toContain(`[OLIT-7] driver: step 1 request: ${MODEL}`);
      expect(
        printed.some(
          (line) =>
            line.startsWith("[OLIT-7] driver: step 1 assistant: ") &&
            line.includes('"send-keys"') &&
            line.includes("press a"),
        ),
      ).toBe(true);
      expect(
        printed.some(
          (line) =>
            line.startsWith("[OLIT-7] driver: step 1 command: ./client") &&
            line.includes('"send-keys"') &&
            line.endsWith("exit 0"),
        ),
      ).toBe(true);
      expect(printed.at(-1)).toBe("[OLIT-7] driver: step 0 stop: result-closed");
      expect(printed.join("\n")).not.toContain(TOKEN);
    }),
  );

  it.effect("prints an OpenRouter failure to stdout before the loop fails (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(
        () =>
          new Response(JSON.stringify({ error: { message: "no credits" } }), {
            status: 402,
            headers: { "content-type": "application/json" },
          }),
      );
      const printed: Array<string> = [];
      const error = yield* Effect.flip(
        run(config(), recorder.layer, () => ({ exitCode: 0 }), [], { printed }),
      );
      expect(error._tag).toBe("OpenRouterRefusal");
      expect(
        printed.some(
          (line) =>
            line.startsWith("[OLI-1] driver: step 1 failure: ") && line.includes("no credits"),
        ),
      ).toBe(true);
      expect(printed.join("\n")).not.toContain(TOKEN);
    }),
  );

  it.effect(
    "a debug log that cannot be written still prints the event before failing (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(done()));
        const printed: Array<string> = [];
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
            write: Effect.fail(denied),
            printed,
          }),
        );
        expect(error._tag).toBe("CommandError");
        expect(printed[0]?.startsWith("[OLI-1] driver: step 0 start: ")).toBe(true);
      }),
  );

  it.effect("get-image sends the screenshot to the model in the next ask, beside the prompt", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(getImage(), done()), withScreen());
      const { stopped: outcome } = yield* run(
        config(),
        recorder.layer,
        () => ({ exitCode: 0 }),
        [],
      );
      expect(outcome).toEqual({ reason: "result-closed" });
      expect(guestPaths(recorder.requests)).toContain("/image");
      expect(imagesAt(recorder.requests, 0)).toEqual([]);
      expect(imagesAt(recorder.requests, 1)).toEqual([PNG_URL]);
      expect(askText(recorder.requests, 1)).toBe("Lock the screen.");
    }),
  );

  it.effect("a screenshot with no action before it has no previous move (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(getImage(), done()), withScreen());
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(imagesAt(recorder.requests, 1)).toEqual([PNG_URL]);
      expect(systemText(modelRequests(recorder.requests)[1]?.body)).not.toContain("previous-move");
    }),
  );

  it.effect("the screenshot bytes are not decoded into the past steps as text", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(getImage(), done()), withScreen());
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      const again = past(recorder.requests, 1);
      expect(again).toContain("look at the screen");
      expect(again).toContain("screenshot");
      expect(again).not.toContain("PNG");
      expect(again).not.toContain("\uFFFD");
    }),
  );

  it.effect("only the latest screenshot is sent when get-image runs twice", () =>
    Effect.gen(function* () {
      const second = new Uint8Array([...PNG, 0x01]);
      let shots = 0;
      const recorder = routed(
        answers(getImage(), getImage(), done()),
        withScreen(() => {
          shots += 1;
          return shots === 1
            ? screenshot()
            : new Response(second, {
                status: 200,
                headers: {
                  "content-type": "image/png",
                  "x-image-url": "https://example.com/images/2",
                },
              });
        }),
      );
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(imagesAt(recorder.requests, 2)).toEqual([
        `data:image/png;base64,${Buffer.from(second).toString("base64")}`,
      ]);
    }),
  );

  it.effect("an action after get-image drops the stale screenshot from the next ask", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(getImage(), sendKeys("press a"), done()), withScreen());
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(imagesAt(recorder.requests, 1)).toEqual([PNG_URL]);
      expect(imagesAt(recorder.requests, 2)).toEqual([]);
    }),
  );

  it.effect("a refused action keeps the screenshot; the screen did not change", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(getImage(), speak("boot", "start"), done()), withScreen());
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(imagesAt(recorder.requests, 2)).toEqual([PNG_URL]);
    }),
  );

  describe("mouse move", () => {
    const tick = (count: number) =>
      Effect.gen(function* () {
        for (let i = 0; i < count; i++) {
          yield* TestClock.adjust(100);
        }
      });
    const moveTo = () => speak("point at Lock", "mouse move --x 0.5 --y 0.5");

    // Each move sleeps on the test clock, so the run is forked and the clock walked past them.
    const driven = (recorder: ReturnType<typeof routed>, log: Array<string> = []) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.exit(run(config(), recorder.layer, () => ({ exitCode: 0 }), log)),
        );
        yield* tick(60);
        return yield* Fiber.join(fiber);
      });
    const bodiesAt = (requests: ReadonlyArray<TestingHttp.Recorded>, path: string) =>
      guestRequests(requests)
        .filter((request) => new URL(request.url).pathname === path)
        .map((request): unknown => JSON.parse(request.body ?? "{}"));
    const click = () => speak("press Lock", "mouse click");

    it.effect("a click lands where the last mouse move left the pointer", () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(speak("point at Lock", "mouse move --x 0.25 --y 0.75"), click(), done()),
        );
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit) && exit.value.stopped).toEqual({ reason: "result-closed" });
        expect(bodiesAt(recorder.requests, "/mouse/click")).toEqual([
          expect.objectContaining({ x: 0.25, y: 0.75, button: "left" }),
        ]);
      }),
    );

    it.effect(
      "a click before any mouse move is refused back to the model and reaches no guest (unhappy)",
      () =>
        Effect.gen(function* () {
          const recorder = routed(answers(click(), done()));
          const exit = yield* driven(recorder);
          expect(Exit.isSuccess(exit)).toBe(true);
          expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
          expect(past(recorder.requests, 1)).toContain(
            "mouse click: no mouse move yet; mouse move to the point first",
          );
        }),
    );

    it.effect("a click that names its own point is refused and reaches no guest (unhappy)", () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(moveTo(), speak("press Lock", "mouse click --x 0.1 --y 0.1"), done()),
        );
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(bodiesAt(recorder.requests, "/mouse/click")).toEqual([]);
        expect(past(recorder.requests, 2)).toContain(
          "mouse click: takes no --x or --y; it clicks where the pointer is",
        );
      }),
    );

    it.effect(
      "a drag starts where the pointer is, and the next click lands where the drag ended",
      () =>
        Effect.gen(function* () {
          const recorder = routed(
            answers(
              speak("grab the window", "mouse move --x 0.25 --y 0.75"),
              speak("move the window", "mouse drag --to-x 0.9 --to-y 0.1"),
              click(),
              done(),
            ),
          );
          const exit = yield* driven(recorder);
          expect(Exit.isSuccess(exit)).toBe(true);
          expect(bodiesAt(recorder.requests, "/mouse/drag")).toEqual([
            expect.objectContaining({ from: { x: 0.25, y: 0.75 }, to: { x: 0.9, y: 0.1 } }),
          ]);
          expect(bodiesAt(recorder.requests, "/mouse/click")).toEqual([
            expect.objectContaining({ x: 0.9, y: 0.1 }),
          ]);
        }),
    );

    it.effect("a nudge moves the pointer a little from where it is, and a click lands there", () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(
            speak("point at Lock", "mouse move --x 0.25 --y 0.25"),
            speak("just above", "mouse move-up"),
            click(),
            done(),
          ),
        );
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit) && exit.value.stopped).toEqual({ reason: "result-closed" });
        expect(bodiesAt(recorder.requests, "/mouse/move")).toEqual([
          expect.objectContaining({ x: 0.25, y: 0.25 }),
          expect.objectContaining({ x: 0.25, y: 0.23 }),
        ]);
        expect(bodiesAt(recorder.requests, "/mouse/click")).toEqual([
          expect.objectContaining({ x: 0.25, y: 0.23 }),
        ]);
      }),
    );

    it.effect("a nudge before any mouse move is refused and reaches no guest (unhappy)", () =>
      Effect.gen(function* () {
        const recorder = routed(answers(speak("just above", "mouse move-up"), done()));
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
        expect(past(recorder.requests, 1)).toContain(
          "mouse move-up: no mouse move yet; mouse move to the point first",
        );
      }),
    );

    it.effect("a move the guest refuses leaves the pointer where it was (unhappy)", () =>
      Effect.gen(function* () {
        let moves = 0;
        const recorder = routed(
          answers(
            speak("point at Lock", "mouse move --x 0.25 --y 0.75"),
            speak("point at Cancel", "mouse move --x 0.9 --y 0.9"),
            click(),
            done(),
          ),
          (url) => {
            if (url.pathname === "/start") {
              return TestingHttp.json({ id: SESSION });
            }
            if (url.pathname === "/mouse/move") {
              moves += 1;
              return moves === 2
                ? TestingHttp.json({ error: "qemu: closed" }, 502)
                : TestingHttp.json({ ok: "true" });
            }
            return TestingHttp.json({ ok: "true" });
          },
        );
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(bodiesAt(recorder.requests, "/mouse/click")).toEqual([
          expect.objectContaining({ x: 0.25, y: 0.75 }),
        ]);
      }),
    );

    const systemAt = (requests: ReadonlyArray<TestingHttp.Recorded>, index: number): string =>
      systemText(modelRequests(requests)[index]?.body);

    it.effect("the ask with the screenshot names the move before it and the values it ran", () =>
      Effect.gen(function* () {
        const recorder = routed(answers(moveTo(), getImage(), done()), withScreen());
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(imagesAt(recorder.requests, 2)).toEqual([PNG_URL]);
        expect(systemAt(recorder.requests, 2)).toContain(
          'Your previous action was mouse move with values {"x":"0.5","y":"0.5"}\nAnd the screenshot provided is the result of your action',
        );
      }),
    );

    it.effect("a click's previous move carries the point the harness filled in", () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(
            speak("point at Lock", "mouse move --x 0.25 --y 0.75"),
            click(),
            getImage(),
            done(),
          ),
          withScreen(),
        );
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(systemAt(recorder.requests, 3)).toContain(
          'Your previous action was mouse click with values {"x":"0.25","y":"0.75"}\n',
        );
      }),
    );

    it.effect("an ask without a screenshot has no previous move (unhappy)", () =>
      Effect.gen(function* () {
        const recorder = routed(answers(moveTo(), done()), withScreen());
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(imagesAt(recorder.requests, 1)).toEqual([]);
        expect(systemAt(recorder.requests, 1)).not.toContain("previous-move");
      }),
    );

    it.effect("a move the guest refuses is not the previous move (unhappy)", () =>
      Effect.gen(function* () {
        let moves = 0;
        const recorder = routed(
          answers(
            speak("point at Lock", "mouse move --x 0.25 --y 0.75"),
            speak("point at Cancel", "mouse move --x 0.9 --y 0.9"),
            getImage(),
            done(),
          ),
          (url) => {
            if (url.pathname === "/start") {
              return TestingHttp.json({ id: SESSION });
            }
            if (url.pathname === "/image") {
              return screenshot();
            }
            if (url.pathname === "/mouse/move") {
              moves += 1;
              return moves === 2
                ? TestingHttp.json({ error: "qemu: closed" }, 502)
                : TestingHttp.json({ ok: "true" });
            }
            return TestingHttp.json({ ok: "true" });
          },
        );
        const exit = yield* driven(recorder);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(systemAt(recorder.requests, 3)).toContain(
          'Your previous action was mouse move with values {"x":"0.25","y":"0.75"}\n',
        );
      }),
    );

    it.effect(
      "three clicks in a row before any mouse move fail the test as bad replies (unhappy)",
      () =>
        Effect.gen(function* () {
          const recorder = routed(answers(click(), click(), click(), done()));
          const exit = yield* driven(recorder);
          expect(Exit.isSuccess(exit) ? exit.value.stopped : undefined).toEqual({
            reason: "limit-reached",
          });
          expect(modelRequests(recorder.requests)).toHaveLength(3);
          expect(bodiesAt(recorder.requests, "/mouse/click")).toEqual([]);
        }),
    );
  });

  it.effect(
    "a failed get-image sends no image and keeps the failure in the next ask (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(getImage(), done()),
          withScreen(() => TestingHttp.json({ error: "qemu: closed" }, 502)),
        );
        const { stopped: outcome } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          [],
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(imagesAt(recorder.requests, 1)).toEqual([]);
        expect(past(recorder.requests, 1)).toContain("qemu: closed");
      }),
  );

  it.effect(
    "a failed get-image tells the model the image failed and the machine is shut down (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(getImage(), done()),
          withScreen(() => TestingHttp.json({ error: "qemu: closed" }, 502)),
        );
        yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
        expect(modelRequests(recorder.requests)).toHaveLength(2);
        expect(guestPaths(recorder.requests).at(-1)).toBe("/stop");
        expect(past(recorder.requests, 1)).toContain("IMAGE HAS FAILED, MACHINE IS SHUT DOWN");
      }),
  );

  it.effect("a successful get-image does not say the machine is shut down", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(getImage(), done()), withScreen());
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(past(recorder.requests, 1)).not.toContain("MACHINE IS SHUT DOWN");
    }),
  );

  it.effect("a failed get-image drops the earlier screenshot too (unhappy)", () =>
    Effect.gen(function* () {
      let shots = 0;
      const recorder = routed(
        answers(getImage(), getImage(), done()),
        withScreen(() => {
          shots += 1;
          return shots === 1 ? screenshot() : TestingHttp.json({ error: "exchange failed" }, 502);
        }),
      );
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(imagesAt(recorder.requests, 1)).toEqual([PNG_URL]);
      expect(imagesAt(recorder.requests, 2)).toEqual([]);
    }),
  );

  it.effect(
    "a mint whose image fails after the shutdown is told to call Done, and its Done saves",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(getImage(), done()),
          withScreen(() => TestingHttp.json({ error: "qemu: closed" }, 502)),
        );
        const log: Array<string> = [];
        const { stopped: outcome, spawner } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
          { seed: { name: "mint", serverUrl: "" } },
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(modelRequests(recorder.requests)).toHaveLength(2);
        expect(past(recorder.requests, 1)).toContain("MACHINE IS SHUT DOWN");
        expect(past(recorder.requests, 1)).toContain("call Done");
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/image",
          "/save",
        ]);
        expect(spawner.spawned[1]?.args).toContain("success");
        expect(events(log).find((event) => event.kind === "stop" && event.step > 0)).toMatchObject({
          step: 2,
          text: "model-stopped",
        });
      }),
  );

  it.effect(
    "a mint that acts again instead of calling Done after the shutdown is ended by the harness and saved (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(getImage(), getImage(), getImage()),
          withScreen(() => TestingHttp.json({ error: "qemu: closed" }, 502)),
        );
        const log: Array<string> = [];
        const { stopped: outcome, spawner } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
          { seed: { name: "mint", serverUrl: "" } },
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(modelRequests(recorder.requests)).toHaveLength(2);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/image",
          "/save",
        ]);
        expect(spawner.spawned[1]?.args).toContain("success");
        expect(events(log).find((event) => event.text === "machine-off")).toMatchObject({
          step: 2,
          kind: "stop",
        });
      }),
  );

  it.effect(
    "a mint whose guest is off answers a reply that is not JSON by ending the drive and saving (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(
          answers(getImage(), notACall()),
          withScreen(() => TestingHttp.json({ error: "qemu: closed" }, 502)),
        );
        const log: Array<string> = [];
        const { stopped: outcome, spawner } = yield* run(
          config(),
          recorder.layer,
          () => ({ exitCode: 0 }),
          log,
          { seed: { name: "mint", serverUrl: "" } },
        );
        expect(outcome).toEqual({ reason: "result-closed" });
        expect(modelRequests(recorder.requests)).toHaveLength(2);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/image",
          "/save",
        ]);
        expect(spawner.spawned[1]?.args).toContain("success");
        expect(events(log).some((event) => event.text === "machine-off")).toBe(true);
      }),
  );

  it.effect(
    "an unknown session ends the loop failed at once and does not ask the model again (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(getImage(), getImage(), getImage()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          return url.pathname === "/image"
            ? TestingHttp.json({ error: `unknown session "${SESSION}"` }, 404)
            : TestingHttp.json({ ok: "true" });
        });
        const log: Array<string> = [];
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 0 }), log),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain(`unknown session "${SESSION}"`);
        }
        expect(modelRequests(recorder.requests)).toHaveLength(1);
        expect(guestPaths(recorder.requests)).toEqual([
          "/start",
          "/intent/start",
          "/image",
          "/stop",
        ]);
        const closed = events(log).find(
          (event) => event.kind === "command" && event.text.startsWith('./ctrl "test-results"'),
        );
        expect(closed?.text).toContain('"failed"');
      }),
  );

  it.effect(
    "an unknown session when step 1's intent opens fails the loop before the model is asked (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(getImage()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          return url.pathname === "/intent/start"
            ? TestingHttp.json({ error: `unknown session "${SESSION}"` }, 404)
            : TestingHttp.json({ ok: "true" });
        });
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 0 }), []),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain(`unknown session "${SESSION}"`);
        }
        expect(modelRequests(recorder.requests)).toHaveLength(0);
        expect(guestPaths(recorder.requests)).toEqual(["/start", "/intent/start", "/stop"]);
      }),
  );

  it.effect(
    "a mint whose save fails after the guest is off closes the result failed with save's headline (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(getImage(), done()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          if (url.pathname === "/image") {
            return TestingHttp.json({ error: "exchange failed" }, 502);
          }
          return url.pathname === "/save"
            ? TestingHttp.json({ error: "minted: could not keep the disk" }, 502)
            : TestingHttp.json({ ok: "true" });
        });
        const log: Array<string> = [];
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 0 }), log, {
            seed: { name: "mint", serverUrl: "" },
          }),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain("minted: could not keep the disk");
        }
        expect(modelRequests(recorder.requests)).toHaveLength(2);
        const closed = events(log).find(
          (event) => event.kind === "command" && event.text.startsWith('./ctrl "test-results"'),
        );
        expect(closed?.text).toContain('"failed"');
        expect(closed?.text).toContain("minted: could not keep the disk");
      }),
  );

  it.effect(
    "a mint whose model calls Done before the guest is off, and whose save is refused, is the model's failure",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(getImage(), done()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          if (url.pathname === "/image") {
            return screenshot();
          }
          return url.pathname === "/save"
            ? TestingHttp.json({ error: "guest did not power off within 2 minutes" }, 409)
            : TestingHttp.json({ ok: "true" });
        });
        const closed: Array<ReadonlyArray<string>> = [];
        const log: Array<string> = [];
        const { stopped } = yield* run(
          config(),
          recorder.layer,
          (_command, args) => {
            if (args[0] === "test-results") {
              closed.push(args);
            }
            return { exitCode: 0 };
          },
          log,
          { seed: { name: "mint", serverUrl: "" } },
        );
        expect(stopped).toEqual({ reason: "not-powered-off" });
        expect(guestPaths(recorder.requests).at(-1)).toBe("/save");
        expect(closed).toHaveLength(1);
        expect(closed[0]).toEqual(expect.arrayContaining(["--status", "failed"]));
        expect(closed[0]?.join(" ")).toContain("guest did not power off within 2 minutes");
        expect(events(log).at(-1)).toMatchObject({ kind: "stop", text: "not-powered-off" });
      }),
  );

  it.effect(
    "a mint whose save fails for its disk after a Done with no failed image is still the run's failure (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(getImage(), done()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          if (url.pathname === "/image") {
            return screenshot();
          }
          return url.pathname === "/save"
            ? TestingHttp.json({ error: "minted: could not keep the disk" }, 502)
            : TestingHttp.json({ ok: "true" });
        });
        const error = yield* Effect.flip(
          run(config(), recorder.layer, () => ({ exitCode: 0 }), [], {
            seed: { name: "mint", serverUrl: "" },
          }),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain("minted: could not keep the disk");
        }
      }),
  );

  it.effect(
    "a mint that never powered off whose result will not close is still the run's failure (unhappy)",
    () =>
      Effect.gen(function* () {
        const recorder = routed(answers(getImage(), done()), (url) => {
          if (url.pathname === "/start") {
            return TestingHttp.json({ id: SESSION });
          }
          if (url.pathname === "/image") {
            return screenshot();
          }
          return url.pathname === "/save"
            ? TestingHttp.json({ error: "guest did not power off within 2 minutes" }, 409)
            : TestingHttp.json({ ok: "true" });
        });
        const error = yield* Effect.flip(
          run(
            config(),
            recorder.layer,
            (_command, args) =>
              args[0] === "test-results"
                ? { exitCode: 1, stderr: "database unreachable" }
                : { exitCode: 0 },
            [],
            { seed: { name: "mint", serverUrl: "" } },
          ),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain("database unreachable");
        }
      }),
  );

  it.effect("get-image --output writes a file and sends no image (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = routed(
        answers(speak("save it", "get-image --output /tmp/shot.png"), done()),
        withScreen(),
      );
      yield* run(config(), recorder.layer, () => ({ exitCode: 0 }), []);
      expect(imagesAt(recorder.requests, 1)).toEqual([]);
    }),
  );

  it.effect("a debug log that cannot be written fails the loop before start", () =>
    Effect.gen(function* () {
      const recorder = routed(answers(done()));
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
