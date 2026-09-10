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
  Option,
  Path,
  Stdio,
  Terminal,
} from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { HttpServerError } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as AutomationClientCommand from "../../src/automation-client/command.ts";
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

type Served = readonly [number, Option.Option<string>];

const fakeServer = (missing: ReadonlyArray<string> = []) => {
  const checked: Array<true> = [];
  const served: Array<Served> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: AutomationClientCommand.AutomationClientServer<never, never> = {
    missingHostRequirements: Effect.sync(() => {
      checked.push(true);
      return missing;
    }),
    serve: (port, url) =>
      Layer.effectDiscard(
        Effect.gen(function* () {
          served.push([port, url]);
          yield* Deferred.succeed(listening, undefined);
        }),
      ),
    serverFailed,
  };
  return { checked, served, listening, serverFailed, server };
};

const DatabaseLive = (ping: Effect.Effect<void, Errors.DatabaseError> = Effect.void) =>
  Layer.succeed(Client.Database)(
    Client.Database.of({
      run: () => Effect.die("unused"),
      transaction: () => Effect.die("unused"),
      ping,
    }),
  );

const run = (
  server: AutomationClientCommand.AutomationClientServer<never, never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  database: Layer.Layer<Client.Database> = DatabaseLive(),
) =>
  Command.runWith(AutomationClientCommand.makeAutomationClientCommand(server), {
    version: Api.VERSION,
  })(args).pipe(Effect.provide(Layer.mergeAll(CliTestLayer, log.layer, database)));

describe("automation client command flags", () => {
  it.effect("--help lists --port and --url and touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const exit = yield* Effect.exit(run(fake.server, ["--help"], log));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("automation-client");
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).toContain("--url");
      expect(stdout.join("\n")).not.toContain("--display");
    }),
  );

  it.effect("--port forty is ShowHelp", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--port", "forty"], log));
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--url not-a-url is refused by the flag", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--url", "not-a-url"], log));
      expect(error._tag).toBe("ShowHelp");
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("url must be an http or https url");
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("defaults to port 42071 and Option.none for the url", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.checked).toEqual([true]);
      expect(fake.served).toEqual([[42071, Option.none()]]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--url http://127.0.0.1:1 reaches serve as given", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, ["--url", "http://127.0.0.1:1"], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(fake.served).toEqual([[42071, Option.some("http://127.0.0.1:1")]]);
    }),
  );

  it.effect("startup order is host check, ping, listen", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const database = Layer.succeed(Client.Database)(
        Client.Database.of({
          run: () => Effect.die("unused"),
          transaction: () => Effect.die("unused"),
          ping: Effect.sync(() => {
            order.push("ping");
          }),
        }),
      );
      const tracked: AutomationClientCommand.AutomationClientServer<never, never> = {
        missingHostRequirements: Effect.sync(() => {
          order.push("host");
          return [];
        }),
        serve: (port, url) =>
          Layer.effectDiscard(
            Effect.gen(function* () {
              order.push("listen");
              fake.served.push([port, url]);
              yield* Deferred.succeed(fake.listening, undefined);
            }),
          ),
        serverFailed: fake.serverFailed,
      };
      const fiber = yield* Effect.forkChild(run(tracked, [], log, database));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(order).toEqual(["host", "ping", "listen"]);
    }),
  );
});

describe("automation client command startup failures", () => {
  it.effect("opencode off the PATH is fatal, no ping, no listen", () =>
    Effect.gen(function* () {
      const missing = ["opencode not on PATH"];
      const fake = fakeServer(missing);
      const log = FakeLog.fakeLog();
      const pinged: Array<true> = [];
      const error = yield* Effect.flip(
        run(
          fake.server,
          [],
          log,
          DatabaseLive(
            Effect.sync(() => {
              pinged.push(true);
            }),
          ),
        ),
      );
      expect(error).toMatchObject({ _tag: "HostRequirementsMissing", missing });
      expect(fake.served).toEqual([]);
      expect(pinged).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: "automation-client: missing host requirements:\nopencode not on PATH",
          location: "automation-client",
          agentId: "automation-client",
          skipSentry: false,
          cause: error,
        },
      ]);
    }),
  );

  it.effect("an unreachable database is fatal and never listens", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const unreachable = Errors.DatabaseError.make({
        operation: "ping",
        message: "database request failed",
        cause: new Error("connect ECONNREFUSED"),
      });
      const error = yield* Effect.flip(
        run(fake.server, [], log, DatabaseLive(Effect.fail(unreachable))),
      );
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "ping",
        message: "database unreachable: connect ECONNREFUSED",
      });
      expect(fake.checked).toEqual([true]);
      expect(fake.served).toEqual([]);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation-client: database unreachable: connect ECONNREFUSED"],
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
        text: "automation-client: accept EMFILE: too many open files",
        skipSentry: false,
      });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:42071");
      const fake = fakeServer();
      const failing: AutomationClientCommand.AutomationClientServer<never, never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(new HttpServerError.ServeError({ cause }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "42071"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation-client: listen EADDRINUSE: address already in use 127.0.0.1:42071"],
      ]);
    }),
  );
});
