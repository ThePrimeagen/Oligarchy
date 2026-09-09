import { fileURLToPath } from "node:url";
import { describe, expect, it as plain } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Result, Schedule, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as OpenCode from "../../src/reverse-proxy/opencode.ts";
import * as Agents from "../../src/shared/agents.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as FakeLog from "../support/log.ts";

// Where ./client and ./ctrl live: the agent is run from there, as a cloud agent runs from its
// checkout.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROMPT = "<role>You are a driving agent</role>\n<model> opencode/grok-code </model>\n";
const SESSION = "ses_7f3a2b1c";
const STARTED = `{"type":"step_start","timestamp":1,"sessionID":"${SESSION}","part":{"type":"step-start"}}\n`;
const ERROR = (error: string) =>
  `{"type":"error","timestamp":1,"sessionID":"${SESSION}","error":${error}}\n`;

// opencode on PATH, and every run kept going until the test says.
const onPath = (
  opencode: FakeSpawner.Scripted | ((args: ReadonlyArray<string>) => FakeSpawner.Scripted) = {},
) => FakeSpawner.byCommand({ "/bin/sh": { exitCode: 0 }, opencode });

// The spawns that are agents: the PATH check is a spawn too.
const runs = (spawner: FakeSpawner.FakeSpawner) =>
  spawner.spawned.filter((spawned) => spawned.command === OpenCode.EXECUTABLE);

const stdinText = (spawned: FakeSpawner.Spawned): Effect.Effect<string> => {
  const stdin = spawned.options.stdin;
  return Stream.isStream(stdin)
    ? Stream.mkString(Stream.decodeText(stdin)).pipe(Effect.orDie)
    : Effect.succeed("stdin is not a stream");
};

// A few turns of the scheduler: enough for a child's exit to reach the fiber that watches it.
const settle = Effect.repeat(Effect.yieldNow, Schedule.recurs(20));

// The layer is built into the test's own scope: the runs live in the layer's scope, so building
// it per prompt would kill each run as its prompt was answered.
const fixture = (
  script: FakeSpawner.Script = onPath(),
): {
  readonly spawner: FakeSpawner.FakeSpawner;
  readonly log: FakeLog.FakeLog;
  readonly layer: Layer.Layer<Agents.Agents>;
  readonly agents: Effect.Effect<Agents.AgentsService, never, Scope.Scope>;
} => {
  const spawner = FakeSpawner.fakeSpawner(script);
  const log = FakeLog.fakeLog();
  const layer = OpenCode.layer.pipe(
    Layer.provide(Layer.mergeAll(spawner.layer, log.layer)),
    Layer.orDie,
  );
  const agents = Effect.flatMap(Layer.build(layer), (services) =>
    Agents.Agents.pipe(Effect.provide(services)),
  );
  return { spawner, log, layer, agents };
};

describe("args", () => {
  plain("says the choice as opencode run takes it: the model as provider/model", () => {
    expect(Result.getOrThrow(OpenCode.args({ model: "anthropic/claude-opus-4" }))).toEqual([
      "run",
      "--format",
      "json",
      "--model",
      "anthropic/claude-opus-4",
    ]);
  });

  plain("a reasoning level is the model's variant", () => {
    expect(
      Result.getOrThrow(OpenCode.args({ model: "openai/gpt-5.5", reasoning: "high" })),
    ).toEqual(["run", "--format", "json", "--model", "openai/gpt-5.5", "--variant", "high"]);
  });

  plain("the default model is OpenCode's own grok, with no knobs turned", () => {
    expect(OpenCode.DEFAULT_MODEL).toEqual({ model: "opencode/grok-code" });
    expect(Result.getOrThrow(OpenCode.args(OpenCode.DEFAULT_MODEL))).toEqual([
      "run",
      "--format",
      "json",
      "--model",
      "opencode/grok-code",
    ]);
  });

  plain("fast is refused: opencode has no fast mode", () => {
    const refused = OpenCode.args({ model: "opencode/grok-code", fast: true });
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure).toMatchObject({
        _tag: "ModelUnavailable",
        model: "opencode/grok-code",
        message: 'model "opencode/grok-code" has no fast mode',
      });
    }
    const slow = OpenCode.args({ model: "opencode/grok-code", fast: false });
    expect(Result.isFailure(slow)).toBe(true);
  });

  plain("a model that is not provider/model is refused before anything runs", () => {
    const refused = OpenCode.args({ model: "grok-4.6", reasoning: "high" });
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure).toMatchObject({
        _tag: "ModelUnavailable",
        model: "grok-4.6",
        message: 'model "grok-4.6" must be provider/model',
      });
    }
  });
});

describe("layer", () => {
  it.effect("checks opencode is on PATH with the shell and answers the default model", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      expect(agents.defaultModel).toEqual({ model: "opencode/grok-code" });
      expect(fixed.spawner.spawned.map((spawned) => [spawned.command, spawned.args])).toEqual([
        ["/bin/sh", ["-c", "command -v opencode"]],
      ]);
    }),
  );

  it.effect("a host without opencode fails the layer as a missing host requirement", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(
        FakeSpawner.byCommand({ "/bin/sh": { exitCode: 1 } }),
      );
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        Layer.build(OpenCode.layer.pipe(Layer.provide(Layer.mergeAll(spawner.layer, log.layer)))),
      );
      expect(error).toMatchObject({
        _tag: "HostRequirementsMissing",
        missing: ["opencode not on PATH"],
        message: "missing host requirements:\nopencode not on PATH",
      });
    }),
  );

  it.effect("a shell that cannot be spawned counts as opencode missing", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(
        FakeSpawner.byCommand({ "/bin/sh": { spawnError: "spawn /bin/sh ENOENT" } }),
      );
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        Layer.build(OpenCode.layer.pipe(Layer.provide(Layer.mergeAll(spawner.layer, log.layer)))),
      );
      expect(error).toMatchObject({ _tag: "HostRequirementsMissing" });
    }),
  );
});

describe("prompt happy path", () => {
  it.effect(
    "runs opencode from the package root with the prompt on stdin and answers the session its first event names",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        const agents = yield* fixed.agents;
        const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
        yield* settle;
        const [run] = runs(fixed.spawner);
        expect(run).toBeDefined();
        expect(run?.args).toEqual(["run", "--format", "json", "--model", "opencode/grok-code"]);
        expect(run?.options).toMatchObject({
          cwd: ROOT,
          stdout: "pipe",
          stderr: "pipe",
          extendEnv: true,
          killSignal: "SIGTERM",
          forceKillAfter: OpenCode.FORCE_KILL_AFTER,
        });
        expect(yield* stdinText(run ?? fail())).toBe(PROMPT);
        // Nothing is answered until opencode has a session.
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* run?.writeStdout(STARTED) ?? Effect.void;
        const started = yield* Fiber.join(fiber);
        expect(started).toEqual({ agentId: SESSION });
        expect("url" in started).toBe(false);
        expect(fixed.log.lines).toEqual([]);
        expect(run?.kills).toEqual([]);
        expect(run?.isReleased()).toBe(false);
      }),
  );

  it.effect("a reasoning level goes as the variant", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(
        agents.prompt(PROMPT, { model: "anthropic/claude-opus-4", reasoning: "max" }),
      );
      yield* settle;
      const [run] = runs(fixed.spawner);
      expect(run?.args).toEqual([
        "run",
        "--format",
        "json",
        "--model",
        "anthropic/claude-opus-4",
        "--variant",
        "max",
      ]);
      yield* run?.writeStdout(STARTED) ?? Effect.void;
      expect(yield* Fiber.join(fiber)).toEqual({ agentId: SESSION });
    }),
  );

  it.effect(
    "a line that is not an event is read past; the first event still names the session",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        const agents = yield* fixed.agents;
        const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
        yield* settle;
        const [run] = runs(fixed.spawner);
        yield* run?.writeStdout("~ https://opencode.ai/s/abc\n") ?? Effect.void;
        yield* run?.writeStdout('{"not":"an event"}\n') ?? Effect.void;
        yield* settle;
        expect(fiber.pollUnsafe()).toBeUndefined();
        // An event may arrive in pieces; the line is what counts.
        yield* run?.writeStdout(STARTED.slice(0, 20)) ?? Effect.void;
        yield* run?.writeStdout(STARTED.slice(20)) ?? Effect.void;
        expect(yield* Fiber.join(fiber)).toEqual({ agentId: SESSION });
      }),
  );

  it.effect("a run that finishes is logged by its session and its child released", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      yield* settle;
      const [run] = runs(fixed.spawner);
      yield* run?.writeStdout(STARTED) ?? Effect.void;
      yield* Fiber.join(fiber);
      yield* (
        run?.writeStdout('{"type":"text","sessionID":"ses_7f3a2b1c","part":{}}\n') ?? Effect.void
      );
      yield* run?.exit(0) ?? Effect.void;
      yield* settle;
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: `agent finished; ${SESSION}`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(run?.isReleased()).toBe(true);
      expect(run?.kills).toEqual([]);
    }),
  );

  it.effect("two prompts are two runs, each answered from its own first event", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const first = yield* Effect.forkChild(agents.prompt("one", OpenCode.DEFAULT_MODEL));
      const second = yield* Effect.forkChild(agents.prompt("two", OpenCode.DEFAULT_MODEL));
      yield* settle;
      const [one, two] = runs(fixed.spawner);
      expect(yield* stdinText(one ?? fail())).toBe("one");
      expect(yield* stdinText(two ?? fail())).toBe("two");
      yield* two?.writeStdout('{"type":"step_start","sessionID":"ses_two"}\n') ?? Effect.void;
      expect(yield* Fiber.join(second)).toEqual({ agentId: "ses_two" });
      expect(first.pollUnsafe()).toBeUndefined();
      yield* one?.writeStdout('{"type":"step_start","sessionID":"ses_one"}\n') ?? Effect.void;
      expect(yield* Fiber.join(first)).toEqual({ agentId: "ses_one" });
    }),
  );
});

describe("prompt unhappy path", () => {
  it.effect("fast is refused before anything is spawned", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const error = yield* Effect.flip(
        agents.prompt(PROMPT, { model: "opencode/grok-code", fast: true }),
      );
      expect(error).toMatchObject({
        _tag: "ModelUnavailable",
        message: 'model "opencode/grok-code" has no fast mode',
      });
      expect(runs(fixed.spawner)).toEqual([]);
    }),
  );

  it.effect("a binary that cannot be spawned is AgentFailed with Node's reason", () =>
    Effect.gen(function* () {
      const fixed = fixture(onPath({ spawnError: "spawn opencode EACCES" }));
      const agents = yield* fixed.agents;
      const error = yield* Effect.flip(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      expect(error).toMatchObject({
        _tag: "AgentFailed",
        message: "opencode: spawn opencode EACCES",
        retryable: false,
      });
      expect(error.cause).toMatchObject({ _tag: "PlatformError" });
    }),
  );

  it.effect("a run that exits before its first event fails with its code and stderr", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      yield* settle;
      const [run] = runs(fixed.spawner);
      yield* run?.exit(1, "Error: no auth for provider anthropic\n") ?? Effect.void;
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "AgentFailed",
        message: "opencode: exited 1 before its first event: Error: no auth for provider anthropic",
        retryable: false,
      });
      expect(run?.isReleased()).toBe(true);
      expect(run?.kills).toEqual([]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("a run that exits silently before its first event names the code alone", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      yield* settle;
      yield* runs(fixed.spawner)[0]?.exit(2) ?? Effect.void;
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error.message).toBe("opencode: exited 2 before its first event");
    }),
  );

  it.effect("a first event that is an error fails with opencode's message and kills the run", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, { model: "anthropic/nope" }));
      yield* settle;
      const [run] = runs(fixed.spawner);
      yield* (
        run?.writeStdout(
          ERROR('{"name":"APIError","data":{"message":"401 invalid x-api-key","statusCode":401}}'),
        ) ?? Effect.void
      );
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "AgentFailed",
        message: "opencode: 401 invalid x-api-key",
        retryable: false,
      });
      expect(run?.kills).toEqual(["SIGTERM"]);
      expect(run?.isReleased()).toBe(true);
    }),
  );

  it.effect("an error without a message is named by its name, anything else as it came", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const named = yield* Effect.forkChild(agents.prompt(PROMPT, { model: "anthropic/nope" }));
      yield* settle;
      yield* (
        runs(fixed.spawner)[0]?.writeStdout(
          ERROR('{"name":"ProviderModelNotFoundError","data":{"providerID":"anthropic"}}'),
        ) ?? Effect.void
      );
      expect((yield* Effect.flip(Fiber.join(named))).message).toBe(
        "opencode: ProviderModelNotFoundError",
      );
      const bare = yield* Effect.forkChild(agents.prompt(PROMPT, { model: "anthropic/nope" }));
      yield* settle;
      yield* runs(fixed.spawner)[1]?.writeStdout(ERROR('"boom"')) ?? Effect.void;
      expect((yield* Effect.flip(Fiber.join(bare))).message).toBe('opencode: "boom"');
    }),
  );

  it.effect("no event within the session timeout kills the run and fails", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      yield* settle;
      const [run] = runs(fixed.spawner);
      yield* TestClock.adjust("59 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "AgentFailed",
        message: `opencode: no event within ${OpenCode.SESSION_TIMEOUT}`,
        retryable: false,
      });
      expect(run?.kills).toEqual(["SIGTERM"]);
      expect(run?.isReleased()).toBe(true);
    }),
  );

  it.effect("a run that fails after it started is an error line with its stderr tail", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      yield* settle;
      const [run] = runs(fixed.spawner);
      yield* run?.writeStdout(STARTED) ?? Effect.void;
      yield* Fiber.join(fiber);
      yield* run?.exit(1, "  rate limited\n") ?? Effect.void;
      yield* settle;
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `agent failed; ${SESSION}; exited 1: rate limited`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(run?.isReleased()).toBe(true);
    }),
  );

  it.effect("a run killed from outside after it started is an error line naming the signal", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const agents = yield* fixed.agents;
      const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
      yield* settle;
      const [run] = runs(fixed.spawner);
      yield* run?.writeStdout(STARTED) ?? Effect.void;
      yield* Fiber.join(fiber);
      yield* run?.die("SIGKILL") ?? Effect.void;
      yield* settle;
      expect(fixed.log.lines.map((line) => [line.level, line.text])).toEqual([
        ["error", `agent failed; ${SESSION}; exited on a signal`],
      ]);
      expect(run?.isReleased()).toBe(true);
    }),
  );

  it.effect("the agents die with the layer: closing its scope kills a run still going", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const services = yield* Layer.build(fixed.layer);
          const agents = yield* Agents.Agents.pipe(Effect.provide(services));
          const fiber = yield* Effect.forkChild(agents.prompt(PROMPT, OpenCode.DEFAULT_MODEL));
          yield* settle;
          yield* runs(fixed.spawner)[0]?.writeStdout(STARTED) ?? Effect.void;
          yield* Fiber.join(fiber);
        }),
      );
      const [run] = runs(fixed.spawner);
      expect(run?.kills).toEqual(["SIGTERM"]);
      expect(run?.isReleased()).toBe(true);
      expect(yield* run?.isRunning ?? Effect.succeed(true)).toBe(false);
    }),
  );
});

const fail = (): never => {
  throw new Error("expected a spawned opencode");
};
