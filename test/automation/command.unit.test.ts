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
  Redacted,
  Stdio,
  Terminal,
} from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { HttpServerError } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as AutomationCommand from "../../src/automation/command.ts";
import * as Client from "../../src/db/client.ts";
import * as Api from "../../src/shared/api.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";

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

const UNREACHABLE = "postgres://user:pw@127.0.0.1:1/oligarchy";

// A Database whose ping is scripted; the pool never connects, so nothing touches the network.
const fakeDatabase = (ping: Effect.Effect<void, Errors.DatabaseError>) =>
  Layer.effect(Client.Database)(
    Effect.map(Client.Database.make(Redacted.make(UNREACHABLE)), (database) => ({
      ...database,
      ping,
    })),
  );

const refused = Errors.DatabaseError.make({
  operation: "ping",
  message: "Failed query: select 1",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:1"),
});

// The server layer and the failure signal the command is built from.
const fakeServer = () => {
  const served: Array<number> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: AutomationCommand.AutomationServer<never> = {
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

const run = (
  server: AutomationCommand.AutomationServer<never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  ping: Effect.Effect<void, Errors.DatabaseError> = Effect.void,
) =>
  Command.runWith(AutomationCommand.makeAutomationCommand(server), { version: Api.VERSION })(
    args,
  ).pipe(Effect.provide(Layer.mergeAll(CliTestLayer, log.layer, fakeDatabase(ping))));

describe("automation command flags", () => {
  it.effect("--port must be an integer", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--port", "forty"], log));
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--help prints the help, succeeds and touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const exit = yield* Effect.exit(run(fake.server, ["--help"], log, Effect.fail(refused)));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).not.toContain("--diagnostics-port");
      expect(stdout.join("\n")).not.toContain("--display");
    }),
  );

  it.effect("defaults to port 54321 and pings the database first", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.served).toEqual([54321]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--port 1234 reaches the server as given", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, ["--port", "1234"], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(fake.served).toEqual([1234]);
    }),
  );
});

describe("automation command startup failures", () => {
  it.effect("an unreachable database fails before listening as database unreachable", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [], log, Effect.fail(refused)));
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "ping",
        message: "database unreachable: connect ECONNREFUSED 127.0.0.1:1",
      });
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: "automation: database unreachable: connect ECONNREFUSED 127.0.0.1:1",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: error,
        },
      ]);
    }),
  );

  it.effect("a ping failure without a nested cause reports the driver's own message", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        run(
          fake.server,
          [],
          log,
          Effect.fail(Errors.DatabaseError.make({ operation: "ping", message: "pool ended" })),
        ),
      );
      expect(error).toMatchObject({ message: "database unreachable: pool ended" });
      expect(log.lines[0]?.text).toBe("automation: database unreachable: pool ended");
    }),
  );

  it.effect("a server error after listen fails the handler with the error's detail", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [], log));
      yield* Deferred.await(fake.listening);
      const cause = new Error("accept EMFILE: too many open files");
      yield* Deferred.fail(fake.serverFailed, new HttpServerError.ServeError({ cause }));
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterruptsOnly(exit.cause)).toBe(false);
        expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "ServeError", cause });
      }
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]).toMatchObject({
        level: "fatal",
        text: "automation: accept EMFILE: too many open files",
        skipSentry: false,
      });
      expect(log.lines[0]?.cause).toMatchObject({ _tag: "ServeError", cause });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:54321");
      const fake = fakeServer();
      const failing: AutomationCommand.AutomationServer<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(new HttpServerError.ServeError({ cause }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "54321"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation: listen EADDRINUSE: address already in use 127.0.0.1:54321"],
      ]);
    }),
  );
});
