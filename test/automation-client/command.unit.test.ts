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

const run = (
  server: AutomationClientCommand.AutomationClient<never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
) =>
  Command.runWith(AutomationClientCommand.makeAutomationClientCommand(server), {
    version: Api.VERSION,
  })(args).pipe(Effect.provide(Layer.mergeAll(CliTestLayer, log.layer)));

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
      const exit = yield* Effect.exit(run(fake.server, ["--help"], log));
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

  it.effect("defaults to port 54322 and listens", () =>
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

  it.effect("a missing DATABASE_URL is fatal as DATABASE_URL is not set", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const failing: AutomationClientCommand.AutomationClient<never> = {
        ...fake.server,
        serve: () =>
          Layer.effectDiscard(Effect.fail(Errors.MissingVariable.make({ name: "DATABASE_URL" }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--url", "http://127.0.0.1:55332"], log));
      expect(error).toMatchObject({ _tag: "MissingVariable", name: "DATABASE_URL" });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation client: DATABASE_URL is not set"],
      ]);
    }),
  );

  it.effect("an unreachable database is fatal as database unreachable", () =>
    Effect.gen(function* () {
      const unreachable = Errors.DatabaseError.make({
        operation: "ping",
        message: "database unreachable: connect ECONNREFUSED 127.0.0.1:1",
      });
      const fake = fakeServer();
      const failing: AutomationClientCommand.AutomationClient<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(unreachable)),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--url", "http://127.0.0.1:55332"], log));
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        message: "database unreachable: connect ECONNREFUSED 127.0.0.1:1",
      });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "automation client: database unreachable: connect ECONNREFUSED 127.0.0.1:1"],
      ]);
    }),
  );
});
