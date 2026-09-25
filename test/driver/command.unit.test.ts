import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Redacted, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Config from "@oligarchy/env/config";
import * as Oligarchy from "@oligarchy/env/oligarchy";
import * as Api from "@oligarchy/routes/api";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as DriverCommand from "../../src/driver/command.ts";
import * as Loop from "../../src/driver/loop.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as Stdio from "../support/stdio.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const MAIN = join(ROOT, "src/driver/main.ts");

// The config provider reads .env from the working directory, so the process runs in an empty one.
const EMPTY_CWD = mkdtempSync(join(tmpdir(), "driver-command-"));
afterAll(() => rmSync(EMPTY_CWD, { recursive: true, force: true }));

// The process, not Command.runWith: main.ts is what builds the layers, and --help must not.
// Nothing from the caller's environment reaches it: only what a test names, plus what bun needs.
const driverProcess = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}) =>
  spawnSync("bun", ["--no-env-file", MAIN, ...args], {
    cwd: EMPTY_CWD,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
  });

const MODEL = "openrouter/test-model";
const TOKEN = "super-secret-token";
const PROMPT = "Lock the screen.";
const LOG = "/tmp/driver-debug.log";

const FLAGS = ["--action", "drive", "--prompt", PROMPT, "--agent-id", "OLI-1", "--debug-log", LOG];

const configText = (models: { readonly drive: string; readonly mint?: string }): string =>
  JSON.stringify({
    models: {
      drive: models.drive,
      diagnose: models.drive,
      mint: models.mint ?? models.drive,
    },
    reasoning: { drive: "minimal", diagnose: "medium", mint: "high" },
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
    timeouts: { header: "3 minutes", chunk: "3 minutes" },
    runCeiling: "1.5 hours",
    stepLimit: 200,
    harness: { defaultRetry: "1 second" },
  });

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
    exists: (path) => Effect.succeed(path === Oligarchy.PATH && contents !== undefined),
    readFileString: (path) => {
      if (path !== Oligarchy.PATH || contents === undefined) {
        return Effect.die(`unexpected read ${path}`);
      }
      return Effect.succeed(contents);
    },
  });

const app = readFileSync(Oligarchy.PATH, "utf8");

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
        Config.fromValues(options?.env ?? { OPENROUTER_API_KEY: TOKEN }),
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
  it.effect("runs one prompt as the drive model from the file and prints why the loop ended", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      yield* run(FLAGS, seen, { contents: configText({ drive: MODEL, mint: "openrouter/mint" }) });
      expect(seen.input?.model).toBe(MODEL);
      expect(seen.input?.reasoning).toBe("minimal");
      expect(seen.input?.prompt).toBe(PROMPT);
      expect(seen.input?.agentId).toBe("OLI-1");
      expect(seen.input?.debugLog).toBe(LOG);
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
          outcome: Effect.fail(
            SharedErrors.CommandError.make({ message: "step limit of 1 reached" }),
          ),
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
      for (const flag of ["action", "prompt", "agent-id", "debug-log"]) {
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

  it.effect(
    "a drive model that is not provider/model names the field and does not start (unhappy)",
    () =>
      Effect.gen(function* () {
        const seen: Seen = { input: undefined };
        const error = yield* Effect.flip(
          run(FLAGS, seen, { contents: configText({ drive: "muse" }) }),
        );
        expect(error._tag).toBe("CommandError");
        if (error._tag === "CommandError") {
          expect(error.message).toContain('["models"]["drive"]');
        }
        expect(seen.input).toBeUndefined();
      }),
  );

  it.effect("--action mint uses the mint model from the file, not the drive model", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      const mint = "openrouter/meta/muse-spark-1.3-contributor";
      yield* run(
        ["--action", "mint", "--prompt", PROMPT, "--agent-id", "OLI-1", "--debug-log", LOG],
        seen,
        { contents: configText({ drive: MODEL, mint }) },
      );
      expect(seen.input?.model).toBe(mint);
      expect(seen.input?.reasoning).toBe("high");
    }),
  );

  it.effect("--action diagnose is a usage error and does not start (unhappy)", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      const error = yield* Effect.flip(
        run(
          ["--action", "diagnose", "--prompt", PROMPT, "--agent-id", "OLI-1", "--debug-log", LOG],
          seen,
        ),
      );
      expect(error._tag).toBe("ShowHelp");
      expect(seen.input).toBeUndefined();
    }),
  );

  it.effect("the driver process --help does not read DATABASE_URL", () =>
    Effect.sync(() => {
      const ran = driverProcess(["--help"]);
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.stdout).toContain("--agent-id");
      expect(`${ran.stdout}\n${ran.stderr}`).not.toContain("DATABASE_URL");
    }),
  );

  it.effect(
    "a missing token is reported before DATABASE_URL when the process actually runs (unhappy)",
    () =>
      Effect.sync(() => {
        const ran = driverProcess(FLAGS);
        expect(ran.status, ran.stderr).not.toBe(0);
        expect(ran.stderr).toContain("OPENROUTER_API_KEY is not set");
        expect(ran.stderr).not.toContain("DATABASE_URL");
      }),
  );

  it.effect("a run with a token and no database reports DATABASE_URL (unhappy)", () =>
    Effect.sync(() => {
      const ran = driverProcess(FLAGS, { OPENROUTER_API_KEY: "present" });
      expect(ran.status, ran.stderr).not.toBe(0);
      expect(ran.stderr).toContain("DATABASE_URL is not set");
    }),
  );

  it.effect("a database url that is not a url is a command error (unhappy)", () =>
    Effect.sync(() => {
      const ran = driverProcess(FLAGS, {
        DATABASE_URL: "not-a-url",
        OPENROUTER_API_KEY: "present",
      });
      expect(ran.status, ran.stderr).not.toBe(0);
      expect(ran.stderr).toContain("db: database url is not a valid url");
      expect(ran.stderr).toContain("CommandError");
      expect(ran.stderr).not.toContain("DatabaseError");
    }),
  );

  it.effect("--help prints the help and does not read the token or the config", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      yield* run(["--help"], seen, { env: {}, contents: undefined });
      const stdout = (yield* TestConsole.logLines).join("\n");
      expect(stdout).toContain("--action");
      expect(stdout).not.toContain("--model");
      expect(stdout).toContain("--prompt");
      expect(stdout).toContain("--agent-id");
      expect(stdout).toContain("--debug-log");
      expect(stdout).not.toContain("--test-definition");
      expect(stdout).not.toContain("--test-proof");
      expect(stdout).not.toContain("--server-url");
      expect(stdout).not.toContain("--test-result-id");
      expect(seen.input).toBeUndefined();
    }),
  );

  it.effect("a missing config is reported before a missing token", () =>
    Effect.gen(function* () {
      const seen: Seen = { input: undefined };
      const missing = yield* Effect.flip(run(FLAGS, seen, { env: {}, contents: undefined }));
      expect(missing._tag).toBe("CommandError");
      if (missing._tag === "CommandError") {
        expect(missing.message).toContain(Oligarchy.PATH);
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
