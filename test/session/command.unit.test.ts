import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, FileSystem, Layer, Path, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { CliError, Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as SessionCommand from "../../src/session/command.ts";
import * as State from "../../src/session/state.ts";
import * as Api from "../../src/shared/api.ts";
import * as Config from "../support/config.ts";
import * as FakeTty from "../support/fake-tty.ts";
import * as StdioSupport from "../support/stdio.ts";
import * as Stores from "../support/stores.ts";

const IMAGE_ID = "9b2f1c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const OTHER_ID = "0c3d2e1f-5a6b-4c7d-9e8f-0a1b2c3d4e5f";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WITH_DB = { DATABASE_URL: "postgres://user:pw@127.0.0.1:5432/oligarchy" };

const IMAGE = ["image", "--image-id", IMAGE_ID];

// The REPL never runs here; its host, spawner and terminal are present so the command tree
// type-checks, and a bare `session` fails on the token before it could touch any of them.
const SpawnerStub = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
  ChildProcessSpawner.make(() => Effect.die("unexpected ChildProcessSpawner.spawn")),
);

const TerminalStub = Layer.succeed(Terminal.Terminal)(
  Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: Effect.die("unexpected Terminal.readInput"),
    readLine: Effect.die("unexpected Terminal.readLine"),
    display: () => Effect.die("unexpected Terminal.display"),
  }),
);

const harness = () => {
  const actions = Stores.fakeActionStore();
  const touched: Array<string> = [];
  const stdio = StdioSupport.capture();
  const command = SessionCommand.makeSessionCommand({
    database: () => {
      touched.push("database");
      return actions.layer;
    },
  });
  const run = (args: ReadonlyArray<string>, env: Record<string, string> = WITH_DB) =>
    Effect.gen(function* () {
      const tty = FakeTty.fakeTty();
      const host = State.Host.of({
        execPath: "/opt/node/bin/node",
        imageProtocol: "ansi",
        input: tty.input,
        output: tty.output,
        termination: Deferred.await(yield* Deferred.make<void>()),
      });
      return yield* Effect.exit(
        Command.runWith(command, { version: Api.VERSION })(args).pipe(
          Effect.provideService(State.Host, host),
          Effect.provide(
            Layer.mergeAll(
              NodeFileSystem.layer,
              NodePath.layer,
              SpawnerStub,
              TerminalStub,
              stdio.layer,
              Config.withEnv(env),
            ),
          ),
        ),
      );
    });
  return { actions, touched, stdio, run };
};

const failure = (exit: Exit.Exit<void, unknown>): unknown => {
  if (Exit.isSuccess(exit)) {
    throw new Error("expected the command to fail");
  }
  return Cause.squash(exit.cause);
};

const helpErrors = (exit: Exit.Exit<void, unknown>): ReadonlyArray<string> => {
  const error = failure(exit);
  if (!CliError.isCliError(error) || error._tag !== "ShowHelp") {
    throw new Error(`expected ShowHelp, got ${String(error)}`);
  }
  return error.errors.map((entry) => entry.message);
};

describe("session image happy path", () => {
  it.effect("prints the stored PNG raw to stdout, straight from the database", () =>
    Effect.gen(function* () {
      const h = harness();
      h.actions.images.push({ id: IMAGE_ID, actionId: 1, data: PNG });
      const exit = yield* h.run(IMAGE);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stdio.stdout).toHaveLength(1);
      expect([...(h.stdio.stdout[0] ?? [])]).toEqual([...PNG]);
      expect(yield* TestConsole.logLines).toEqual([]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("-o and --output write the PNG to the file with mode 0o644 and print nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const h = harness();
      h.actions.images.push({ id: IMAGE_ID, actionId: 1, data: PNG });

      const short = path.join(dir, "short.png");
      expect(Exit.isSuccess(yield* h.run([...IMAGE, "-o", short]))).toBe(true);
      expect([...(yield* fs.readFile(short))]).toEqual([...PNG]);
      expect((yield* fs.stat(short)).mode & 0o777).toBe(0o644);

      const long = path.join(dir, "long.png");
      expect(Exit.isSuccess(yield* h.run([...IMAGE, "--output", long]))).toBe(true);
      expect([...(yield* fs.readFile(long))]).toEqual([...PNG]);

      expect(h.stdio.stdout).toEqual([]);
      expect(yield* TestConsole.logLines).toEqual([]);
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("needs DATABASE_URL and nothing of the proxy: no OLIGARCHY_TOKEN, no SERVER_URL", () =>
    Effect.gen(function* () {
      const h = harness();
      h.actions.images.push({ id: IMAGE_ID, actionId: 1, data: PNG });
      const exit = yield* h.run(IMAGE, { ...WITH_DB, OLIGARCHY_TOKEN: "", SERVER_URL: "" });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stdio.stdout).toHaveLength(1);
    }),
  );

  it.effect("--help on session and on image touches nothing and exits 0", () =>
    Effect.gen(function* () {
      const h = harness();
      for (const args of [["--help"], ["image", "--help"]]) {
        expect(Exit.isSuccess(yield* h.run(args, {}))).toBe(true);
      }
      expect(h.touched).toEqual([]);
      const printed = (yield* TestConsole.logLines).join("\n");
      expect(printed).toMatch(/--image-id/);
      expect(printed).toMatch(/--server-url/);
    }),
  );
});

describe("session image unhappy path", () => {
  it.effect("refuses an id no image has, and prints nothing", () =>
    Effect.gen(function* () {
      const h = harness();
      h.actions.images.push({ id: OTHER_ID, actionId: 1, data: PNG });
      const exit = yield* h.run(IMAGE);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: `image: no image ${IMAGE_ID}`,
      });
      expect(h.stdio.stdout).toEqual([]);
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );

  it.effect("refuses an id that is not a uuid before touching the database", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["image", "--image-id", "last.png"]);
      expect(helpErrors(exit).join("\n")).toMatch(
        /Invalid value for flag --image-id: "last\.png".*image-id must be a uuid/s,
      );
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("requires --image-id, and takes no positional id", () =>
    Effect.gen(function* () {
      const h = harness();
      const missing = yield* h.run(["image"]);
      expect(helpErrors(missing).join("\n")).toMatch(/Missing required flag: --image-id/);
      const positional = yield* h.run(["image", IMAGE_ID]);
      expect(helpErrors(positional).length).toBeGreaterThan(0);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("requires DATABASE_URL after parsing and before any query", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(IMAGE, { OLIGARCHY_TOKEN: "t" });
      expect(failure(exit)).toMatchObject({
        _tag: "MissingVariable",
        message: "DATABASE_URL is not set",
      });
      expect(h.touched).toEqual([]);
      expect(h.stdio.stdout).toEqual([]);
    }),
  );

  it.effect("a bare session still wants OLIGARCHY_TOKEN first and never opens the database", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run([], WITH_DB);
      expect(failure(exit)).toMatchObject({
        _tag: "MissingVariable",
        message: "OLIGARCHY_TOKEN is not set",
      });
      expect(h.touched).toEqual([]);
    }),
  );
});
