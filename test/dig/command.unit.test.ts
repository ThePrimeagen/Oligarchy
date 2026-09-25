import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Stdio,
  Terminal,
} from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { HttpServerError } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Api from "@oligarchy/routes/api";
import * as DigCommand from "../../src/dig/command.ts";

const CliTestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal)(
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
    ChildProcessSpawner.make(() => Effect.die("unused")),
  ),
);

const fakeServer = () => {
  const served: Array<number> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: DigCommand.DigServer<never> = {
    serve: (port) =>
      Layer.effectDiscard(
        Effect.gen(function* () {
          served.push(port);
          yield* Deferred.succeed(listening, undefined);
        }),
      ),
    serverFailed,
  };
  return { served, listening, serverFailed, server };
};

const run = (server: DigCommand.DigServer<never>, args: ReadonlyArray<string>) =>
  Command.runWith(DigCommand.makeDigCommand(server), { version: Api.VERSION })(args).pipe(
    Effect.provide(CliTestLayer),
  );

describe("dig command happy path", () => {
  it.effect("--help prints the help, succeeds and does not listen", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const exit = yield* Effect.exit(run(fake.server, ["--help"]));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.served).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("dig");
      expect(stdout.join("\n")).toContain("--port");
    }),
  );

  it.effect("defaults to port 8080", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const fiber = yield* Effect.forkChild(run(fake.server, []));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.served).toEqual([8080]);
    }),
  );
});

describe("dig command unhappy path", () => {
  it.effect("--port must be an integer and does not listen", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const error = yield* Effect.flip(run(fake.server, ["--port", "nope"]));
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
    }),
  );
});
