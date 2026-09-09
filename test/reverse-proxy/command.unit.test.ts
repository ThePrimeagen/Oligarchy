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
import * as Config from "../../src/config.ts";
import * as Client from "../../src/db/client.ts";
import * as ReverseProxyCommand from "../../src/reverse-proxy/command.ts";
import * as Api from "../../src/shared/api.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeLog from "../support/log.ts";

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

const UNREACHABLE = "postgres://user:pw@127.0.0.1:1/oligarchy";

// The working directory as the command sees it: the config files it may read, nothing else.
const OPENCODE = '{ "agent-executable": "opencode" }\n';
const CURSOR = '{ "agent-executable": "cursor" }\n';
const files = (contents: Record<string, string>) =>
  FileSystem.layerNoop({
    readFileString: (path) => {
      const text = contents[path];
      return text === undefined
        ? Effect.fail(FakeFs.notFound("readFileString", path))
        : Effect.succeed(text);
    },
  });
const DEFAULT_FILES = { [Config.DEFAULT_REVERSE_PROXY_CONFIG]: OPENCODE };

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

type Served = readonly [port: number, diagnosticsPort: number, agent: Config.AgentExecutable];

// The server layer and the failure signal the command is built from.
const fakeServer = () => {
  const served: Array<Served> = [];
  const listening = Deferred.makeUnsafe<void>();
  const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
  const server: ReverseProxyCommand.ReverseProxyServer<never> = {
    serve: (port, diagnosticsPort, config) =>
      Layer.effectDiscard(
        Effect.gen(function* () {
          served.push([port, diagnosticsPort, config["agent-executable"]]);
          yield* Deferred.succeed(listening, undefined);
        }),
      ),
    serverFailed,
  };
  return { served, listening, serverFailed, server };
};

const run = (
  server: ReverseProxyCommand.ReverseProxyServer<never>,
  args: ReadonlyArray<string>,
  log: FakeLog.FakeLog,
  options: {
    readonly ping?: Effect.Effect<void, Errors.DatabaseError>;
    readonly files?: Record<string, string>;
  } = {},
) =>
  Command.runWith(ReverseProxyCommand.makeReverseProxyCommand(server), { version: Api.VERSION })(
    args,
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        CliTestLayer,
        files(options.files ?? DEFAULT_FILES),
        log.layer,
        fakeDatabase(options.ping ?? Effect.void),
      ),
    ),
  );

describe("reverse proxy command flags", () => {
  it.effect("--port and --diagnostics-port must be integers", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const port = yield* Effect.flip(run(fake.server, ["--port", "forty"], log));
      expect(port._tag).toBe("ShowHelp");
      const diagnostics = yield* Effect.flip(
        run(fake.server, ["--diagnostics-port", "fifty"], log),
      );
      expect(diagnostics._tag).toBe("ShowHelp");
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("--help prints the help, succeeds and touches nothing", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const exit = yield* Effect.exit(
        run(fake.server, ["--help"], log, { ping: Effect.fail(refused), files: {} }),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([]);
      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("--port");
      expect(stdout.join("\n")).toContain("--diagnostics-port");
      expect(stdout.join("\n")).toContain("--config");
      expect(stdout.join("\n")).toContain(".reverse-proxy.oligarchy.json");
      expect(stdout.join("\n")).not.toContain("--display");
    }),
  );

  it.effect(
    "defaults to port 42070 with diagnostics on 55445, reads .reverse-proxy.oligarchy.json and pings the database first",
    () =>
      Effect.gen(function* () {
        const fake = fakeServer();
        const log = FakeLog.fakeLog();
        const fiber = yield* Effect.forkChild(run(fake.server, [], log));
        yield* Deferred.await(fake.listening);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(fake.served).toEqual([[42070, 55445, "opencode"]]);
        expect(log.lines).toEqual([]);
      }),
  );

  it.effect("--port 1234 --diagnostics-port 5678 --config <path> reach the server as given", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(
        run(
          fake.server,
          ["--port", "1234", "--diagnostics-port", "5678", "--config", "/etc/oligarchy/rp.json"],
          log,
          { files: { "/etc/oligarchy/rp.json": CURSOR } },
        ),
      );
      yield* Deferred.await(fake.listening);
      yield* Fiber.interrupt(fiber);
      expect(fake.served).toEqual([[1234, 5678, "cursor"]]);
    }),
  );
});

describe("reverse proxy command startup failures", () => {
  it.effect("a config file that is not there is fatal before the database is pinged", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, [], log, { ping: Effect.fail(refused), files: {} }),
      );
      expect(error).toMatchObject({
        _tag: "InvalidConfig",
        path: ".reverse-proxy.oligarchy.json",
        message: "config .reverse-proxy.oligarchy.json not found",
      });
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: "reverse proxy: config .reverse-proxy.oligarchy.json not found",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: error,
        },
      ]);
    }),
  );

  it.effect("a config file naming an executable nobody knows is fatal with the schema's word", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(
        run(fake.server, ["--config", "rp.json"], log, {
          files: { "rp.json": '{"agent-executable":"vim"}' },
        }),
      );
      expect(error).toMatchObject({ _tag: "InvalidConfig", path: "rp.json" });
      expect(fake.served).toEqual([]);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        [
          "fatal",
          'reverse proxy: config rp.json: Expected "cursor" | "opencode"\n  at ["agent-executable"]',
        ],
      ]);
    }),
  );

  it.effect("an unreachable database fails before listening as database unreachable", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(fake.server, [], log, { ping: Effect.fail(refused) }));
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "ping",
        message: "database unreachable: connect ECONNREFUSED 127.0.0.1:1",
      });
      expect(fake.served).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "fatal",
          text: "reverse proxy: database unreachable: connect ECONNREFUSED 127.0.0.1:1",
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
        run(fake.server, [], log, {
          ping: Effect.fail(
            Errors.DatabaseError.make({ operation: "ping", message: "pool ended" }),
          ),
        }),
      );
      expect(error).toMatchObject({ message: "database unreachable: pool ended" });
      expect(log.lines[0]?.text).toBe("reverse proxy: database unreachable: pool ended");
    }),
  );

  // The agent program's own requirement is checked by the server layer, after the ping: Cursor's
  // key, or opencode on PATH.
  it.effect("a server layer that wants a variable the environment lacks is fatal by its name", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const missing = Errors.MissingVariable.make({ name: "CURSOR_API_TOKEN" });
      const wanting: ReverseProxyCommand.ReverseProxyServer<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(missing)),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(wanting, [], log));
      expect(error).toBe(missing);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "reverse proxy: CURSOR_API_TOKEN is not set"],
      ]);
    }),
  );

  it.effect("a server layer whose host lacks the agent program is fatal naming it", () =>
    Effect.gen(function* () {
      const fake = fakeServer();
      const missing = Errors.HostRequirementsMissing.make({ missing: ["opencode not on PATH"] });
      const wanting: ReverseProxyCommand.ReverseProxyServer<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(missing)),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(wanting, [], log));
      expect(error).toBe(missing);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "reverse proxy: missing host requirements:\nopencode not on PATH"],
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
        text: "reverse proxy: accept EMFILE: too many open files",
        skipSentry: false,
      });
      expect(log.lines[0]?.cause).toMatchObject({ _tag: "ServeError", cause });
    }),
  );

  it.effect("a listen failure is fatal with the bind error's message", () =>
    Effect.gen(function* () {
      const cause = new Error("listen EADDRINUSE: address already in use 127.0.0.1:42070");
      const fake = fakeServer();
      const failing: ReverseProxyCommand.ReverseProxyServer<never> = {
        ...fake.server,
        serve: () => Layer.effectDiscard(Effect.fail(new HttpServerError.ServeError({ cause }))),
      };
      const log = FakeLog.fakeLog();
      const error = yield* Effect.flip(run(failing, ["--port", "42070"], log));
      expect(error).toMatchObject({ _tag: "ServeError", cause });
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["fatal", "reverse proxy: listen EADDRINUSE: address already in use 127.0.0.1:42070"],
      ]);
    }),
  );
});
