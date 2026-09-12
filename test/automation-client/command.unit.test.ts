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

const fakeServer = () => {
  const served: Array<Served> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: AutomationClientCommand.AutomationClient<never> = {
    serve: (port, url) =>
      Layer.effectDiscard(
        Effect.gen(function* () {
          served.push([port, url]);
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

const run = (
  server: AutomationClientCommand.AutomationClient<never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  database: Layer.Layer<Client.Database> = DatabaseLive(),
) =>
  Command.runWith(AutomationClientCommand.makeAutomationClientCommand(server), {
    version: Api.VERSION,
  })(args).pipe(Effect.provide(Layer.mergeAll(CliTestLayer, log.layer, database)));

describe("automation client command flags", () => {
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
      const exit = yield* Effect.exit(
        run(
          fake.server,
          ["--help"],
          log,
          DatabaseLive(
            Effect.fail(
              Errors.DatabaseError.make({
                operation: "ping",
                message: "database request failed",
                cause: new Error("connect ECONNREFUSED"),
              }),
            ),
          ),
        ),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("automation-client");
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).toContain("--url");
      expect(stdout.join("\n")).not.toContain("--display");
    }),
  );

  it.effect("defaults to port 54322, pings the database, and listens", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.served).toEqual([[54322, Option.none()]]);
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
      expect(fake.served).toEqual([[1234, Option.none()]]);
    }),
  );

  it.effect("--url reaches the server as given, so it announces itself under that url", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(
        run(fake.server, ["--url", "http://127.0.0.1:55332"], log),
      );
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(fake.served).toEqual([[54322, Option.some("http://127.0.0.1:55332")]]);
    }),
  );

  it.effect("a --url that is not an http or https url is a usage error that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--url", "ftp://qemu.example.com"], log));
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors.length).toBeGreaterThan(0);
        expect(error.errors[0]?._tag).toBe("InvalidValue");
      }
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("url must be an http or https url");
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );
});

describe("automation client command startup failures", () => {
  it.effect("an unreachable database is fatal and never listens (unhappy)", () =>
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
      expect(fake.served).toEqual([]);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation client: database unreachable: connect ECONNREFUSED"],
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
          DatabaseLive(
            Effect.fail(Errors.DatabaseError.make({ operation: "ping", message: "pool ended" })),
          ),
        ),
      );
      expect(error).toMatchObject({ message: "database unreachable: pool ended" });
      expect(log.lines[0]?.text).toBe("automation client: database unreachable: pool ended");
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
        text: "automation client: accept EMFILE: too many open files",
        skipSentry: false,
      });
      expect(log.lines[0]?.cause).toMatchObject({ _tag: "ServeError", cause });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:54322");
      const fake = fakeServer();
      const failing: AutomationClientCommand.AutomationClient<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(new HttpServerError.ServeError({ cause }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "54322"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation client: listen EADDRINUSE: address already in use 127.0.0.1:54322"],
      ]);
    }),
  );
});
