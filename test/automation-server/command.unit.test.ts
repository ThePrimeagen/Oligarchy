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
import * as AutomationServerCommand from "../../src/automation-server/command.ts";
import * as Automation from "../../src/db/automation.ts";
import * as Client from "../../src/db/client.ts";
import * as Api from "../../src/shared/api.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

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

// The server layer and the failure signal the command is built from.
const fakeServer = () => {
  const served: Array<number> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: AutomationServerCommand.AutomationServer<never> = {
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

const DatabaseLive = (ping: Effect.Effect<void, Errors.DatabaseError> = Effect.void) =>
  Layer.succeed(Client.Database)(
    Client.Database.of({
      run: () => Effect.die("unused"),
      transaction: () => Effect.die("unused"),
      ping,
    }),
  );

const trackingAutomation = (
  abortRunning: (reason: string) => Effect.Effect<number, Errors.DatabaseError> = () =>
    Effect.succeed(0),
) => {
  const abortCalls: Array<string> = [];
  const store = Stores.fakeAutomationStore({
    abortRunning: (reason) =>
      Effect.gen(function* () {
        abortCalls.push(reason);
        return yield* abortRunning(reason);
      }),
  });
  return { abortCalls, layer: store.layer };
};

const run = (
  server: AutomationServerCommand.AutomationServer<never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  database: Layer.Layer<Client.Database> = DatabaseLive(),
  automation: Layer.Layer<Automation.AutomationStore> = trackingAutomation().layer,
) =>
  Command.runWith(AutomationServerCommand.makeAutomationServerCommand(server), {
    version: Api.VERSION,
  })(args).pipe(Effect.provide(Layer.mergeAll(CliTestLayer, log.layer, database, automation)));

describe("automation server command flags", () => {
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
      const exit = yield* Effect.exit(run(fake.server, ["--help"], log));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("automation-server");
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).not.toContain("--diagnostics-port");
      expect(stdout.join("\n")).not.toContain("--display");
    }),
  );

  it.effect("defaults to port 54321, pings the database, sweeps, and listens", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const automation = trackingAutomation();
      const fiber = yield* Effect.forkChild(
        run(fake.server, [], log, DatabaseLive(), automation.layer),
      );
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.served).toEqual([54321]);
      expect(automation.abortCalls).toEqual(["automation-server restarted"]);
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

describe("automation server command startup failures", () => {
  it.effect("an unreachable database is fatal and never listens (unhappy)", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const automation = trackingAutomation();
      const unreachable = Errors.DatabaseError.make({
        operation: "ping",
        message: "database request failed",
        cause: new Error("connect ECONNREFUSED"),
      });
      const error = yield* Effect.flip(
        run(fake.server, [], log, DatabaseLive(Effect.fail(unreachable)), automation.layer),
      );
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "ping",
        message: "database unreachable: connect ECONNREFUSED",
      });
      expect(fake.served).toEqual([]);
      expect(automation.abortCalls).toEqual([]);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation server: database unreachable: connect ECONNREFUSED"],
      ]);
    }),
  );

  it.effect("a sweep that fails is fatal and never listens (unhappy)", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const refused = Errors.DatabaseError.make({
        operation: "abortRunning",
        message: "Failed query: update automation_jobs",
        cause: new Error("connect ECONNREFUSED"),
      });
      const automation = trackingAutomation(() => Effect.fail(refused));
      const error = yield* Effect.flip(run(fake.server, [], log, DatabaseLive(), automation.layer));
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "abortRunning",
        message: "Failed query: update automation_jobs",
      });
      expect(fake.served).toEqual([]);
      expect(automation.abortCalls).toEqual(["automation-server restarted"]);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation server: Failed query: update automation_jobs"],
      ]);
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
        text: "automation server: accept EMFILE: too many open files",
        skipSentry: false,
      });
      expect(log.lines[0]?.cause).toMatchObject({ _tag: "ServeError", cause });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:54321");
      const fake = fakeServer();
      const failing: AutomationServerCommand.AutomationServer<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(new HttpServerError.ServeError({ cause }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "54321"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation server: listen EADDRINUSE: address already in use 127.0.0.1:54321"],
      ]);
    }),
  );
});
