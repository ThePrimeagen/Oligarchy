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
import { CliError, Command } from "effect/unstable/cli";
import { HttpServerError } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Client from "../../src/db/client.ts";
import * as ProxyCommand from "../../src/proxy/command.ts";
import * as Api from "../../src/shared/api.ts";
import type * as Domain from "../../src/shared/domain.ts";
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

type Served = readonly [Domain.QemuDisplay, boolean, number];

// The host check, the server layer and the failure signal the command is built from.
const fakeServer = (missing: ReadonlyArray<string> = []) => {
  const checked: Array<Domain.QemuDisplay> = [];
  const served: Array<Served> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: ProxyCommand.ProxyServer<never, never> = {
    missingHostRequirements: (display) =>
      Effect.sync(() => {
        checked.push(display);
        return missing;
      }),
    serve: (display, automation, port) =>
      Layer.effectDiscard(
        Effect.gen(function* () {
          served.push([display, automation, port]);
          yield* Deferred.succeed(listening, undefined);
        }),
      ),
    serverFailed,
  };
  return { checked, served, listening, serverFailed, server };
};

const run = (
  server: ProxyCommand.ProxyServer<never, never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  ping: Effect.Effect<void, Errors.DatabaseError> = Effect.void,
) =>
  Command.runWith(ProxyCommand.makeProxyCommand(server), { version: Api.VERSION })(args).pipe(
    Effect.provide(Layer.mergeAll(CliTestLayer, log.layer, fakeDatabase(ping))),
  );

describe("proxy command flags", () => {
  it.effect("--automation with --display is a UserError that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--automation", "--display", "gtk"], log));
      expect(CliError.isCliError(error)).toBe(true);
      expect(error).toMatchObject({ _tag: "UserError", userMessage: "--automation is exclusive" });
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("--automation is exclusive");
    }),
  );

  it.effect("--automation --display none is exclusive too", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, ["--display", "none", "--automation"], log),
      );
      expect(error).toMatchObject({ _tag: "UserError", userMessage: "--automation is exclusive" });
      expect(fake.served).toEqual([]);
    }),
  );

  it.effect("--display curses is a usage error", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--display", "curses"], log));
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors.length).toBeGreaterThan(0);
        expect(error.errors[0]?._tag).toBe("InvalidValue");
      }
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--port must be an integer", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, ["--port", "forty"], log));
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
    }),
  );

  it.effect("--help prints the help, succeeds and touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const exit = yield* Effect.exit(run(fake.server, ["--help"], log));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("--automation");
      expect(stdout.join("\n")).toContain("--display");
      expect(stdout.join("\n")).toContain("--port");
    }),
  );

  it.effect("defaults to display none and port 42069 and checks the host before listening", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.checked).toEqual(["none"]);
      expect(fake.served).toEqual([["none", false, 42069]]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--display gtk --port 1234 and --automation reach the server as given", () =>
    Effect.gen(function* () {
      const gtk = fakeServer();
      const log = FakeLog.fakeLog();
      const first = yield* Effect.forkChild(
        run(gtk.server, ["--display", "gtk", "--port", "1234"], log),
      );
      yield* Deferred.await(gtk.listening);
      yield* Fiber.interrupt(first);
      expect(gtk.checked).toEqual(["gtk"]);
      expect(gtk.served).toEqual([["gtk", false, 1234]]);

      const automation = fakeServer();
      const second = yield* Effect.forkChild(run(automation.server, ["--automation"], log));
      yield* Deferred.await(automation.listening);
      yield* Fiber.interrupt(second);
      expect(automation.checked).toEqual(["none"]);
      expect(automation.served).toEqual([["none", true, 42069]]);
    }),
  );
});

describe("proxy command startup failures", () => {
  it.effect("missing host requirements fail before any ping or listen and log fatal", () =>
    Effect.gen(function* () {
      const missing = [
        "qemu-system-x86_64 not on PATH",
        "/dev/kvm is not readable and writable (needed for accel=kvm)",
      ];
      const fake = fakeServer(missing);
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [], log, Effect.fail(refused)));
      expect(error).toMatchObject({ _tag: "HostRequirementsMissing", missing });
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: `proxy: missing host requirements:\n${missing.join("\n")}`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: error,
        },
      ]);
    }),
  );

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
      expect(fake.checked).toEqual(["none"]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: "proxy: database unreachable: connect ECONNREFUSED 127.0.0.1:1",
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
      expect(log.lines[0]?.text).toBe("proxy: database unreachable: pool ended");
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
        text: "proxy: accept EMFILE: too many open files",
        skipSentry: false,
      });
      expect(log.lines[0]?.cause).toMatchObject({ _tag: "ServeError", cause });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:42069");
      const fake = fakeServer();
      const failing: ProxyCommand.ProxyServer<never, never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(new HttpServerError.ServeError({ cause }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "42069"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "proxy: listen EADDRINUSE: address already in use 127.0.0.1:42069"],
      ]);
    }),
  );
});
