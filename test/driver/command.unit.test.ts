import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Redacted, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as DriverCommand from "../../src/driver/command.ts";
import * as Loop from "../../src/driver/loop.ts";
import * as HarnessConfig from "../../src/harness/config.ts";
import * as Api from "../../src/shared/api.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Support from "../support/config.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as Stdio from "../support/stdio.ts";

const MODEL = "openrouter/test-model";
const RESULT = "22222222-2222-4222-8222-222222222222";
const TOKEN = "super-secret-token";
const PROMPT = "Lock the screen.";
const LOG = "/tmp/driver-debug.log";

const FLAGS = [
  "--model",
  MODEL,
  "--prompt",
  PROMPT,
  "--debug-log",
  LOG,
  "--test-result-id",
  RESULT,
];

const TerminalStub = Layer.succeed(Terminal.Terminal)(
  Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: Effect.die("unexpected Terminal.readInput"),
    readLine: Effect.die("unexpected Terminal.readLine"),
    display: () => Effect.die("unexpected Terminal.display"),
  }),
);

const file = (contents: string | undefined) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path === HarnessConfig.PATH && contents !== undefined),
    readFileString: (path) => {
      if (path !== HarnessConfig.PATH || contents === undefined) {
        return Effect.die(`unexpected read ${path}`);
      }
      return Effect.succeed(contents);
    },
  });

const app = readFileSync(HarnessConfig.PATH, "utf8");

type Seen = { input: Loop.Input | undefined };

const harness =
  (seen: Seen, outcome?: Effect.Effect<Loop.Stopped, Loop.Failure>) => (input: Loop.Input) =>
    Effect.gen(function* () {
      seen.input = input;
      if (outcome === undefined) {
        return { reason: "model-stopped" } satisfies Loop.Stopped;
      }
      return yield* outcome;
    });

const run = (
  args: ReadonlyArray<string>,
  seen: Seen,
  options?: {
    readonly env?: Record<string, string>;
    readonly contents?: string | undefined;
    readonly outcome?: Effect.Effect<Loop.Stopped, Loop.Failure>;
  },
) =>
  Command.runWith(DriverCommand.makeDriverCommand(harness(seen, options?.outcome)), {
    version: Api.VERSION,
  })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        Support.withEnv(options?.env ?? { OPENROUTER_API_KEY: TOKEN }),
        file(options && "contents" in options ? options.contents : app),
        Stdio.capture().layer,
        TerminalStub,
        Path.layer,
        FakeHttp.die,
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
          ChildProcessSpawner.make(() => Effect.die("unexpected spawn")),
        ),
      ),
    ),
  );

describe("driver command", () => {
  it.effect("runs one prompt and one model and prints why the loop ended", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      yield* run(FLAGS, seen);
      expect(seen.input?.model).toBe(MODEL);
      expect(seen.input?.prompt).toBe(PROMPT);
      expect(seen.input?.debugLog).toBe(LOG);
      expect(seen.input?.testResultId).toBe(RESULT);
      expect(seen.input?.action).toBe("drive");
      expect(seen.input?.config.stepLimit).toBeGreaterThanOrEqual(1);
      expect(Redacted.value(seen.input?.token ?? Redacted.make(""))).toBe(TOKEN);
      expect(yield* TestConsole.logLines).toEqual(["model-stopped"]);
    }),
  );

  it.effect("a loop failure is the reason, and a closed result is a normal end", () =>
    Effect.gen(function* () {
      const failed: Seen = { input: undefined };
      const error = yield* Effect.flip(
        run(FLAGS, failed, {
          outcome: Effect.fail(Errors.CommandError.make({ message: "step limit of 1 reached" })),
        }),
      );
      expect(error).toMatchObject({ _tag: "CommandError", message: "step limit of 1 reached" });
      expect(yield* TestConsole.logLines).toEqual([]);

      const closed: Seen = { input: undefined };
      yield* run(FLAGS, closed, { outcome: Effect.succeed({ reason: "result-closed" }) });
      expect(yield* TestConsole.logLines).toEqual(["result-closed"]);
    }),
  );

  it.effect("a missing flag is a usage error that does not start the loop", () =>
    Effect.gen(function* () {
      for (const flag of ["model", "prompt", "debug-log", "test-result-id"]) {
        const seen: Seen = { input: undefined };
        const args = FLAGS.filter(
          (arg, index) => arg !== `--${flag}` && FLAGS[index - 1] !== `--${flag}`,
        );
        const error = yield* Effect.flip(run(args, seen));
        expect(error._tag, flag).toBe("ShowHelp");
        if (error._tag === "ShowHelp") {
          expect(error.errors).toMatchObject([{ _tag: "MissingOption", option: flag }]);
        }
        const stderr = yield* TestConsole.errorLines;
        expect(stderr.join("\n"), flag).toContain(`--${flag}`);
        expect(seen.input, flag).toBeUndefined();
      }
    }),
  );

  it.effect("a model that is not provider/model is a usage error", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      const error = yield* Effect.flip(
        run(
          ["--model", "muse", "--prompt", PROMPT, "--debug-log", LOG, "--test-result-id", RESULT],
          seen,
        ),
      );
      expect(error._tag).toBe("ShowHelp");
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("model must be provider/model");
      expect(seen.input).toBeUndefined();
    }),
  );

  it.effect("--action diagnose reaches the loop, and an unknown action is a usage error", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      yield* run([...FLAGS, "--action", "diagnose"], seen);
      expect(seen.input?.action).toBe("diagnose");

      const refused: Seen = { input: undefined };
      const error = yield* Effect.flip(run([...FLAGS, "--action", "review"], refused));
      expect(error._tag).toBe("ShowHelp");
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("action");
      expect(refused.input).toBeUndefined();
    }),
  );

  it.effect("--help prints the help and does not read the token or the config", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      yield* run(["--help"], seen, { env: {}, contents: undefined });
      const stdout = (yield* TestConsole.logLines).join("\n");
      expect(stdout).toContain("--model");
      expect(stdout).toContain("--prompt");
      expect(stdout).toContain("--debug-log");
      expect(stdout).toContain("--test-result-id");
      expect(seen.input).toBeUndefined();
    }),
  );

  it.effect("a missing config is reported before a missing token", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      const missing = yield* Effect.flip(run(FLAGS, seen, { env: {}, contents: undefined }));
      expect(missing._tag).toBe("CommandError");
      if (missing._tag === "CommandError") {
        expect(missing.message).toContain(HarnessConfig.PATH);
        expect(missing.message).toContain("missing");
      }
      expect(seen.input).toBeUndefined();

      const token = yield* Effect.flip(run(FLAGS, seen, { env: { OPENROUTER_API_KEY: "" } }));
      expect(token).toMatchObject({
        _tag: "MissingVariable",
        name: "OPENROUTER_API_KEY",
        message: "OPENROUTER_API_KEY is not set",
      });
      expect(seen.input).toBeUndefined();
    }),
  );
});
