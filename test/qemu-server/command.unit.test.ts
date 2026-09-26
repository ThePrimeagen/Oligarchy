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
  Redacted,
  Stdio,
  Terminal,
} from "effect";
import { TestConsole } from "effect/testing";
import { CliError, Command } from "effect/unstable/cli";
import { HttpServerError } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Client from "@oligarchy/db/client";
import * as DbErrors from "@oligarchy/db/errors";
import * as Config from "@oligarchy/env/config";
import * as Api from "@oligarchy/http/api";
import type * as Domain from "@oligarchy/shared/domain";
import * as QemuServerCommand from "../../src/qemu-server/command.ts";
import * as Qemu from "../../src/qemu/qemu.ts";
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
const fakeDatabase = (ping: Effect.Effect<void, DbErrors.DatabaseError>) =>
  Layer.effect(Client.Database)(
    Effect.map(Client.Database.make(Redacted.make(UNREACHABLE)), (database) => ({
      ...database,
      ping,
    })),
  );

const refused = DbErrors.DatabaseError.make({
  operation: "ping",
  message: "Failed query: select 1",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:1"),
});

type Served = readonly [
  Domain.QemuDisplay,
  boolean,
  number,
  string,
  number,
  Option.Option<string>,
  string,
];

// --max-jobs and --name have no default, so every run that should reach the handler carries both.
const MAX_JOBS: ReadonlyArray<string> = ["--max-jobs", "2"];
const NAME: ReadonlyArray<string> = ["--name", "garage"];
const REQUIRED: ReadonlyArray<string> = [...MAX_JOBS, ...NAME];
// What a run without --data-dir and without OLIGARCHY_DATA_DIR keeps its cache under.
const DATA_DIR = Qemu.dataDir;

// The host check and the server the command is built from; `serverFailed` is a server error after listen.
const fakeServer = (missing: ReadonlyArray<string> = []) => {
  const checked: Array<Domain.QemuDisplay> = [];
  const served: Array<Served> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: QemuServerCommand.QemuServer<never, never> = {
    missingHostRequirements: (display) =>
      Effect.sync(() => {
        checked.push(display);
        return missing;
      }),
    serve: (display, automation, maxJobs, name, port, url, dataDir) =>
      Effect.gen(function* () {
        served.push([display, automation, maxJobs, name, port, url, dataDir]);
        yield* Deferred.succeed(listening, undefined);
        return yield* Deferred.await(serverFailed);
      }),
  };
  return { checked, served, listening, serverFailed, server };
};

// An empty environment by default: the process's own OLIGARCHY_DATA_DIR must not reach a test.
const run = (
  server: QemuServerCommand.QemuServer<never, never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  ping: Effect.Effect<void, DbErrors.DatabaseError> = Effect.void,
  env: Config.Values = {},
) =>
  Command.runWith(QemuServerCommand.makeQemuServerCommand(server), { version: Api.VERSION })(
    args,
  ).pipe(
    Effect.provide(
      Layer.mergeAll(CliTestLayer, log.layer, fakeDatabase(ping), Config.fromValues(env)),
    ),
  );

describe("qemu server command flags", () => {
  it.effect("--automation with --display is a UserError that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, [...REQUIRED, "--automation", "--display", "gtk"], log),
      );
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
        run(fake.server, [...REQUIRED, "--display", "none", "--automation"], log),
      );
      expect(error).toMatchObject({ _tag: "UserError", userMessage: "--automation is exclusive" });
      expect(fake.served).toEqual([]);
    }),
  );

  it.effect("--display curses is a usage error", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [...REQUIRED, "--display", "curses"], log));
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
      const error = yield* Effect.flip(run(fake.server, [...REQUIRED, "--port", "forty"], log));
      expect(error._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
    }),
  );

  it.effect("a missing --max-jobs is a usage error that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [...NAME, "--automation"], log));
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors).toMatchObject([{ _tag: "MissingOption", option: "max-jobs" }]);
      }
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("--max-jobs");
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("a missing --name is a usage error that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [...MAX_JOBS, "--automation"], log));
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors).toMatchObject([{ _tag: "MissingOption", option: "name" }]);
      }
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("--name");
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("an empty --name is a usage error that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [...MAX_JOBS, "--name", ""], log));
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors).toMatchObject([{ _tag: "InvalidValue", option: "name" }]);
      }
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--max-jobs below 1 or not an integer is a usage error with the flag's rule", () =>
    Effect.gen(function* () {
      const log = FakeLog.fakeLog();
      // The negative in `=` form: a bare `-1` after the flag is itself read as a flag.
      for (const args of [
        [...NAME, "--max-jobs", "0"],
        [...NAME, "--max-jobs=-1"],
      ]) {
        const fake = fakeServer();
        const error = yield* Effect.flip(run(fake.server, args, log));
        expect(error._tag).toBe("ShowHelp");
        if (error._tag === "ShowHelp") {
          expect(error.errors).toMatchObject([{ _tag: "InvalidValue", option: "max-jobs" }]);
        }
        expect(fake.checked).toEqual([]);
        expect(fake.served).toEqual([]);
      }
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("max-jobs must be at least 1");
      for (const value of ["1.5", "two"]) {
        const fake = fakeServer();
        const error = yield* Effect.flip(run(fake.server, [...NAME, "--max-jobs", value], log));
        expect(error._tag).toBe("ShowHelp");
        expect(fake.served).toEqual([]);
      }
      expect(log.lines).toEqual([]);
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
      expect(stdout.join("\n")).toContain("qemu-server");
      expect(stdout.join("\n")).toContain("--automation");
      expect(stdout.join("\n")).toContain("--display");
      expect(stdout.join("\n")).toContain("--max-jobs");
      expect(stdout.join("\n")).toContain("--name");
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).toContain("--url");
      expect(stdout.join("\n")).toContain("--data-dir");
    }),
  );

  it.effect("defaults to display none and port 42069 and checks the host before listening", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [...REQUIRED], log));
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(fake.checked).toEqual(["none"]);
      expect(fake.served).toEqual([["none", false, 2, "garage", 42069, Option.none(), DATA_DIR]]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--display gtk --port 1234 and --automation reach the server as given", () =>
    Effect.gen(function* () {
      const gtk = fakeServer();
      const log = FakeLog.fakeLog();
      const first = yield* Effect.forkChild(
        run(gtk.server, [...REQUIRED, "--display", "gtk", "--port", "1234"], log),
      );
      yield* Deferred.await(gtk.listening);
      yield* Fiber.interrupt(first);
      expect(gtk.checked).toEqual(["gtk"]);
      expect(gtk.served).toEqual([["gtk", false, 2, "garage", 1234, Option.none(), DATA_DIR]]);

      const automation = fakeServer();
      const second = yield* Effect.forkChild(
        run(automation.server, [...REQUIRED, "--automation"], log),
      );
      yield* Deferred.await(automation.listening);
      yield* Fiber.interrupt(second);
      expect(automation.checked).toEqual(["none"]);
      expect(automation.served).toEqual([
        ["none", true, 2, "garage", 42069, Option.none(), DATA_DIR],
      ]);
    }),
  );

  it.effect("--max-jobs reaches the server as given, in either flag form", () =>
    Effect.gen(function* () {
      const log = FakeLog.fakeLog();
      const spaced = fakeServer();
      const first = yield* Effect.forkChild(run(spaced.server, [...NAME, "--max-jobs", "3"], log));
      yield* Deferred.await(spaced.listening);
      yield* Fiber.interrupt(first);
      expect(spaced.served).toEqual([["none", false, 3, "garage", 42069, Option.none(), DATA_DIR]]);

      const joined = fakeServer();
      const second = yield* Effect.forkChild(run(joined.server, [...NAME, "--max-jobs=1"], log));
      yield* Deferred.await(joined.listening);
      yield* Fiber.interrupt(second);
      expect(joined.served).toEqual([["none", false, 1, "garage", 42069, Option.none(), DATA_DIR]]);
    }),
  );

  it.effect("--name reaches the server as given, in either flag form", () =>
    Effect.gen(function* () {
      const log = FakeLog.fakeLog();
      const spaced = fakeServer();
      const first = yield* Effect.forkChild(
        run(spaced.server, [...MAX_JOBS, "--name", "attic"], log),
      );
      yield* Deferred.await(spaced.listening);
      yield* Fiber.interrupt(first);
      expect(spaced.served).toEqual([["none", false, 2, "attic", 42069, Option.none(), DATA_DIR]]);

      const joined = fakeServer();
      const second = yield* Effect.forkChild(
        run(joined.server, [...MAX_JOBS, "--name=rack-2"], log),
      );
      yield* Deferred.await(joined.listening);
      yield* Fiber.interrupt(second);
      expect(joined.served).toEqual([["none", false, 2, "rack-2", 42069, Option.none(), DATA_DIR]]);
    }),
  );

  it.effect("--url reaches the server as given, so it announces itself under that url", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(
        run(fake.server, [...REQUIRED, "--url", "http://127.0.0.1:55332", "--automation"], log),
      );
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(fake.served).toEqual([
        ["none", true, 2, "garage", 42069, Option.some("http://127.0.0.1:55332"), DATA_DIR],
      ]);
    }),
  );

  it.effect("--data-dir reaches the server as given and beats OLIGARCHY_DATA_DIR", () =>
    Effect.gen(function* () {
      const log = FakeLog.fakeLog();
      const flagged = fakeServer();
      const first = yield* Effect.forkChild(
        run(flagged.server, [...REQUIRED, "--data-dir", "/srv/oligarchy-2"], log),
      );
      yield* Deferred.await(flagged.listening);
      yield* Fiber.interrupt(first);
      expect(flagged.served).toEqual([
        ["none", false, 2, "garage", 42069, Option.none(), "/srv/oligarchy-2"],
      ]);

      const both = fakeServer();
      const second = yield* Effect.forkChild(
        run(both.server, [...REQUIRED, "--data-dir=/srv/oligarchy-3"], log, Effect.void, {
          OLIGARCHY_DATA_DIR: "/srv/from-env",
        }),
      );
      yield* Deferred.await(both.listening);
      yield* Fiber.interrupt(second);
      expect(both.served[0]?.[6]).toBe("/srv/oligarchy-3");
    }),
  );

  it.effect("OLIGARCHY_DATA_DIR stands in for --data-dir; empty counts as unset", () =>
    Effect.gen(function* () {
      const log = FakeLog.fakeLog();
      const fromEnv = fakeServer();
      const first = yield* Effect.forkChild(
        run(fromEnv.server, [...REQUIRED], log, Effect.void, {
          OLIGARCHY_DATA_DIR: "/srv/from-env",
        }),
      );
      yield* Deferred.await(fromEnv.listening);
      yield* Fiber.interrupt(first);
      expect(fromEnv.served[0]?.[6]).toBe("/srv/from-env");

      const empty = fakeServer();
      const second = yield* Effect.forkChild(
        run(empty.server, [...REQUIRED], log, Effect.void, { OLIGARCHY_DATA_DIR: "" }),
      );
      yield* Deferred.await(empty.listening);
      yield* Fiber.interrupt(second);
      expect(empty.served[0]?.[6]).toBe(DATA_DIR);
      expect(DATA_DIR.endsWith("/.oligarchy")).toBe(true);
    }),
  );

  it.effect("an empty --data-dir is a usage error that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [...REQUIRED, "--data-dir", ""], log));
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors).toMatchObject([{ _tag: "InvalidValue", option: "data-dir" }]);
      }
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("a --url that is not an http or https url is a usage error that touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, [...REQUIRED, "--url", "ftp://qemu.example.com"], log),
      );
      expect(error._tag).toBe("ShowHelp");
      if (error._tag === "ShowHelp") {
        expect(error.errors.length).toBeGreaterThan(0);
        expect(error.errors[0]?._tag).toBe("InvalidValue");
      }
      const stderr = yield* TestConsole.errorLines;
      expect(stderr.join("\n")).toContain("url must be an http or https url");
      expect(fake.checked).toEqual([]);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );
});

describe("qemu server command startup failures", () => {
  it.effect("missing host requirements fail before any ping or listen and log fatal", () =>
    Effect.gen(function* () {
      const missing = [
        "qemu-system-x86_64 not on PATH",
        "/dev/kvm is not readable and writable (needed for accel=kvm)",
      ];
      const fake = fakeServer(missing);
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [...REQUIRED], log, Effect.fail(refused)));
      expect(error).toMatchObject({ _tag: "HostRequirementsMissing", missing });
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: `qemu server: missing host requirements:\n${missing.join("\n")}`,
          location: "server",
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
      const error = yield* Effect.flip(run(fake.server, [...REQUIRED], log, Effect.fail(refused)));
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
          text: "qemu server: database unreachable: connect ECONNREFUSED 127.0.0.1:1",
          location: "server",
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
          [...REQUIRED],
          log,
          Effect.fail(DbErrors.DatabaseError.make({ operation: "ping", message: "pool ended" })),
        ),
      );
      expect(error).toMatchObject({ message: "database unreachable: pool ended" });
      expect(log.lines[0]?.text).toBe("qemu server: database unreachable: pool ended");
    }),
  );

  it.effect("a server error after listen fails the handler with the error's detail", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(run(fake.server, [...REQUIRED], log));
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
        text: "qemu server: accept EMFILE: too many open files",
        skipSentry: false,
      });
      expect(log.lines[0]?.cause).toMatchObject({ _tag: "ServeError", cause });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:42069");
      const fake = fakeServer();
      const failing: QemuServerCommand.QemuServer<never, never> = {
        ...fake.server,
        serve: () => Effect.fail(new HttpServerError.ServeError({ cause })),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, [...REQUIRED, "--port", "42069"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "qemu server: listen EADDRINUSE: address already in use 127.0.0.1:42069"],
      ]);
    }),
  );

  it.effect("a restart cleanup that cannot write is fatal with the database error's message", () =>
    Effect.gen(function* () {
      const cleanup = DbErrors.DatabaseError.make({
        operation: "failRoutedSessions",
        message: "connect ECONNREFUSED 127.0.0.1:5432",
      });
      const fake = fakeServer();
      const failing: QemuServerCommand.QemuServer<never, never> = {
        ...fake.server,
        serve: () => Effect.fail(cleanup),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, [...REQUIRED], log));
      expect(error).toBe(cleanup);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "qemu server: connect ECONNREFUSED 127.0.0.1:5432"],
      ]);
    }),
  );
});
