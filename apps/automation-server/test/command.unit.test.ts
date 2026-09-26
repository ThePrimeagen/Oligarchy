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
import * as Client from "@oligarchy/db/client";
import * as DbErrors from "@oligarchy/db/errors";
import * as Oligarchy from "@oligarchy/env/oligarchy";
import * as Api from "@oligarchy/http/api";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { HttpServerError } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as AutomationServerCommand from "../src/command.ts";
import * as TestingLog from "@oligarchy/testing/log";

const APP = JSON.stringify({
  models: {
    drive: "openrouter/meta/muse-spark-1.3-contributor",
    diagnose: "openrouter/meta/muse-spark-1.3-contributor",
    mint: "openrouter/meta/muse-spark-1.3-contributor",
  },
  reasoning: { drive: "minimal", diagnose: "minimal", mint: "minimal" },
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  timeouts: { header: "3 minutes", chunk: "3 minutes" },
  runCeiling: "1.5 hours",
  stepLimit: 200,
  harness: { defaultRetry: "1 second" },
});

const configFs = (text: string | undefined) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path === Oligarchy.PATH && text !== undefined),
    readFileString: (path) => {
      if (path !== Oligarchy.PATH || text === undefined) {
        return Effect.die(`unexpected read ${path}`);
      }
      return Effect.succeed(text);
    },
  });

const CliTestLayer = Layer.mergeAll(
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

const MUSE = "openrouter/meta/muse-spark-1.3-contributor";
const MODELS = { drive: MUSE, diagnose: MUSE, mint: MUSE };

// The server the command is built from; `serverFailed` is a server error after listen.
const fakeServer = () => {
  const served: Array<{
    readonly port: number;
    readonly models: { readonly drive: string; readonly diagnose: string; readonly mint: string };
  }> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: AutomationServerCommand.AutomationServer<never> = {
    serve: (port, models) =>
      Effect.gen(function* () {
        served.push({ port, models });
        yield* Deferred.succeed(listening, undefined);
        return yield* Deferred.await(serverFailed);
      }),
  };
  return { served, listening, serverFailed, server };
};

const DatabaseLive = (ping: Effect.Effect<void, DbErrors.DatabaseError> = Effect.void) =>
  Layer.succeed(Client.Database)(
    Client.Database.of({
      run: () => Effect.die("unused"),
      transaction: () => Effect.die("unused"),
      ping,
    }),
  );

const run = (
  server: AutomationServerCommand.AutomationServer<never>,
  args: ReadonlyArray<string>,
  log: TestingLog.FakeLog,
  database: Layer.Layer<Client.Database> = DatabaseLive(),
  file: Layer.Layer<FileSystem.FileSystem> = configFs(APP),
) =>
  Command.runWith(AutomationServerCommand.makeAutomationServerCommand(server), {
    version: Api.VERSION,
  })(args).pipe(Effect.provide(Layer.mergeAll(CliTestLayer, file, log.layer, database)));

describe("automation server command flags", () => {
  it.effect("--port must be an integer", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--port", "forty"], log));
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--help prints the help, succeeds and touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
      const exit = yield* Effect.exit(run(fake.server, ["--help"], log));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("automation-server");
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).not.toContain("--model");
      expect(stdout.join("\n")).not.toContain("--jobs");
      expect(stdout.join("\n")).not.toContain("--max-jobs");
      expect(stdout.join("\n")).not.toContain("--diagnostics-port");
      expect(stdout.join("\n")).not.toContain("--display");
    }),
  );

  it.effect(
    "defaults to port 54321 and the models in oligarchy.json, pings the database, and listens",
    () =>
      Effect.gen(function* () {
        const fake = fakeServer();
        const log = TestingLog.fakeLog();
        const fiber = yield* Effect.forkChild(run(fake.server, [], log));
        yield* Deferred.await(fake.listening);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(fake.served).toEqual([{ port: 54321, models: MODELS }]);
        expect(log.lines).toEqual([]);
      }),
  );

  it.effect("--port 1234 reaches the server as given", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, ["--port", "1234"], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(fake.served).toEqual([{ port: 1234, models: MODELS }]);
    }),
  );

  it.effect("--model is not a flag and the server does not listen (unhappy)", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, ["--model", "openrouter/deepseek/deepseek-v4.1-flash"], log),
      );
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("a missing oligarchy.json is fatal and never listens (unhappy)", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, [], log, DatabaseLive(), configFs(undefined)),
      );
      expect(error._tag).toBe("CommandError");
      if (error._tag === "CommandError") {
        expect(error.message).toContain(Oligarchy.PATH);
        expect(error.message).toContain("missing");
      }
      expect(fake.served).toEqual([]);
      expect(log.lines.map((line) => line.level)).toEqual(["fatal"]);
      expect(log.lines[0]?.text).toContain(Oligarchy.PATH);
    }),
  );
});

describe("automation server command startup failures", () => {
  it.effect("an unreachable database is fatal and never listens (unhappy)", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
      const unreachable = DbErrors.DatabaseError.make({
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
        ["fatal", "automation server: database unreachable: connect ECONNREFUSED"],
      ]);
    }),
  );

  it.effect("a server error after listen fails the handler with the error's detail", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = TestingLog.fakeLog();
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
        serve: () => Effect.fail(new HttpServerError.ServeError({ cause })),
      };
      const log = TestingLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "54321"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation server: listen EADDRINUSE: address already in use 127.0.0.1:54321"],
      ]);
    }),
  );
});
