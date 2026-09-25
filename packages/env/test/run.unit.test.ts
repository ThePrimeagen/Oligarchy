import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Cause,
  Console,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Stdio,
  Terminal,
} from "effect";
import { TestConsole } from "effect/testing";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Log from "@oligarchy/log/log";
import * as Colors from "../src/colors.ts";
import * as Config from "../src/config.ts";
import * as EnvFile from "../src/env-file.ts";
import * as Errors from "../src/errors.ts";
import * as Env from "../src/run.ts";
import { withProcessEnv } from "./process-env.ts";

// The platform the runner would get from Env.run, faked: arguments from the test, a file system
// the test scripts, a terminal nothing may read. The CLI writes through Console, so TestConsole
// sees help, usage and the version.
const platform = (
  args: ReadonlyArray<string>,
  files: Layer.Layer<FileSystem.FileSystem> = FileSystem.layerNoop({}),
) =>
  Layer.mergeAll(
    Stdio.layerTest({ args: Effect.succeed(args) }),
    files,
    Path.layer,
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
      ChildProcessSpawner.make(() => Effect.die("unexpected ChildProcessSpawner.spawn")),
    ),
    Layer.succeed(Terminal.Terminal)(
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        readInput: Effect.die("unexpected Terminal.readInput"),
        readLine: Effect.die("unexpected Terminal.readLine"),
        display: () => Effect.die("unexpected Terminal.display"),
      }),
    ),
  );

class Greeting extends Context.Service<Greeting, { readonly word: string }>()(
  "@oligarchy/env/test/Greeting",
) {}

const greet = Command.make(
  "greet",
  { loud: Flag.boolean("loud").pipe(Flag.withDefault(false)) },
  ({ loud }) =>
    Effect.gen(function* () {
      const { word } = yield* Greeting;
      yield* Console.log(loud ? word.toUpperCase() : word);
    }),
);

const GreetingLive = Layer.succeed(Greeting)(Greeting.of({ word: "hello" }));

const run = <Name extends string, Input, ContextInput, E, R, ROut, LE, RIn>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  args: ReadonlyArray<string>,
  options: Env.Options<ROut, LE, RIn>,
) => Effect.exit(Env.program(command, options).pipe(Effect.provide(platform(args))));

describe("Env.program", () => {
  it.effect(
    "runs the command under its layer and the environment: a success is a success (happy)",
    () =>
      Effect.gen(function* () {
        const exit = yield* run(greet, ["--loud"], { version: "1.2.3", layer: GreetingLive });
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* TestConsole.logLines).toEqual(["HELLO"]);
        expect(yield* TestConsole.errorLines).toEqual([]);
      }),
  );

  it.effect("--version prints the version passed in, and the help offers no wizard (happy)", () =>
    Effect.gen(function* () {
      const version = yield* run(greet, ["--version"], { version: "1.2.3", layer: GreetingLive });
      expect(Exit.isSuccess(version)).toBe(true);
      expect((yield* TestConsole.logLines).join("\n")).toContain("1.2.3");
      const help = yield* run(greet, ["--help"], { version: "1.2.3", layer: GreetingLive });
      expect(Exit.isSuccess(help)).toBe(true);
      const text = (yield* TestConsole.logLines).join("\n");
      expect(text).toContain("--loud");
      expect(text).not.toMatch(/wizard/i);
      expect(yield* TestConsole.errorLines).toEqual([]);
    }),
  );

  it.effect("a failing command prints one headline, then the cause (unhappy)", () =>
    Effect.gen(function* () {
      const failing = Command.make("fail", {}, () =>
        Effect.fail(Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" })),
      );
      const exit = yield* run(failing, [], { version: "1", layer: Layer.empty });
      expect(Exit.isFailure(exit)).toBe(true);
      const printed = yield* TestConsole.errorLines;
      expect(printed).toHaveLength(1);
      const [first, ...rest] = String(printed[0]).split("\n");
      expect(first).toBe("OLIGARCHY_TOKEN is not set");
      expect(rest.join("\n")).toContain("OLIGARCHY_TOKEN is not set");
    }),
  );

  it.effect("a usage error is rendered by the CLI and nothing more is printed (unhappy)", () =>
    Effect.gen(function* () {
      const exit = yield* run(greet, ["--nope"], { version: "1", layer: GreetingLive });
      expect(Exit.isFailure(exit)).toBe(true);
      expect((yield* TestConsole.logLines).join("\n")).toContain("USAGE");
      const printed = yield* TestConsole.errorLines;
      expect(printed).toHaveLength(1);
      expect(String(printed[0])).toContain("Unrecognized flag: --nope");
    }),
  );

  it.effect(
    "a layer that cannot be built prints its headline before the command runs (unhappy)",
    () =>
      Effect.gen(function* () {
        const broken = Layer.effect(Greeting)(
          Effect.map(Config.linearTeam, (word) => Greeting.of({ word })),
        );
        const exit = yield* withProcessEnv(
          { LINEAR_TEAM: undefined },
          run(greet, [], { version: "1", layer: broken }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        expect(String((yield* TestConsole.errorLines)[0])).toContain("LINEAR_TEAM is not set");
        expect(yield* TestConsole.logLines).toEqual([]);
      }),
  );

  it.effect(
    "with failuresLogged a command's failure prints nothing, a defect still does (unhappy)",
    () =>
      Effect.gen(function* () {
        const failing = Command.make("fail", {}, () =>
          Effect.fail(Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" })),
        );
        const quiet = yield* run(failing, [], {
          version: "1",
          layer: Layer.empty,
          failuresLogged: true,
        });
        expect(Exit.isFailure(quiet)).toBe(true);
        expect(yield* TestConsole.errorLines).toEqual([]);
        const dying = Command.make("die", {}, () => Effect.die(new Error("boom")));
        const loud = yield* run(dying, [], {
          version: "1",
          layer: Layer.empty,
          failuresLogged: true,
        });
        expect(Exit.isFailure(loud) && Cause.hasDies(loud.cause)).toBe(true);
        expect(String((yield* TestConsole.errorLines)[0])).toContain("boom");
      }),
  );

  it.effect("provides Log.Colors as stdout decided it (happy)", () =>
    Effect.gen(function* () {
      const colors = Command.make("colors", {}, () =>
        Effect.gen(function* () {
          yield* Console.log(String(yield* Log.Colors));
        }),
      );
      const exit = yield* run(colors, [], { version: "1", layer: Layer.empty });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* TestConsole.logLines).toEqual([String(Colors.stdoutColors)]);
    }),
  );

  it.effect(
    "reads variables through the live chain, so an --env-file fills what the process lacks (happy)",
    () =>
      Effect.gen(function* () {
        const team = Command.make("team", {}, () =>
          Effect.gen(function* () {
            yield* Console.log(yield* Config.linearTeam);
          }),
        ).pipe(EnvFile.withEnvFile);
        const files = FileSystem.layerNoop({
          exists: (path) => Effect.succeed(path === ".prod-env"),
          readFileString: (path) =>
            path === ".prod-env"
              ? Effect.succeed("LINEAR_TEAM=Prod Board\n")
              : Effect.die(`unexpected readFileString ${path}`),
        });
        const exit = yield* withProcessEnv(
          { LINEAR_TEAM: undefined },
          Effect.exit(
            Env.program(team, { version: "1", layer: Layer.empty }).pipe(
              Effect.provide(platform(["--env-file", ".prod-env"], files)),
            ),
          ),
        );
        expect(Exit.isSuccess(exit), (yield* TestConsole.logLines).join("\n")).toBe(true);
        expect(yield* TestConsole.logLines).toEqual(["Prod Board"]);
      }),
  );
});
