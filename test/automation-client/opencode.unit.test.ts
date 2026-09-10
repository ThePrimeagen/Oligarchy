import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, FileSystem, Layer, Path, Redacted, Scope, Stream } from "effect";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Runner from "../../src/automation-client/runner.ts";
import * as Config from "../../src/config.ts";
import * as Render from "../../src/observability/render.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TOKEN = "sentinel-opencode-token";
const DATABASE_URL = "postgres://user:sentinel-db-pw@127.0.0.1:1/x";
const KEY = "OLI-45";
const PROMPT = "drive the guest to the lock screen";

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make(TOKEN),
  databaseUrl: Redacted.make(DATABASE_URL),
});

type Written = { readonly data: string; readonly mode: number | undefined };

type MemoryFs = {
  readonly files: Map<string, Written>;
  readonly removed: Array<string>;
  readonly layer: Layer.Layer<FileSystem.FileSystem>;
};

const memoryFs = (): MemoryFs => {
  const files = new Map<string, Written>();
  const removed: Array<string> = [];
  let next = 0;
  const layer = FileSystem.layerNoop({
    makeTempDirectoryScoped: (options) =>
      Effect.gen(function* () {
        const dir = `/tmp/${options?.prefix ?? "tmp"}${String((next += 1))}`;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            removed.push(dir);
            for (const path of [...files.keys()]) {
              if (path === dir || path.startsWith(`${dir}/`)) {
                files.delete(path);
              }
            }
          }),
        );
        return dir;
      }),
    writeFileString: (path, data, options) =>
      Effect.sync(() => {
        files.set(path, { data, mode: options?.mode });
      }),
  });
  return { files, removed, layer };
};

const env = (spawner: FakeSpawner.FakeSpawner, fs: MemoryFs, log: FakeLog.FakeLog) =>
  OpenCode.layer.pipe(
    Layer.provide(spawner.layer),
    Layer.provide(fs.layer),
    Layer.provide(Path.layer),
    Layer.provide(ProxyConfigLive),
    Layer.provide(log.layer),
  );

// Synthetic captured events: S2 could not be run here.
const TEXT_LINE = JSON.stringify({
  type: "text",
  sessionID: "ses_synthetic_run",
  part: { text: "done" },
});
const ERROR_LINE = JSON.stringify({
  type: "error",
  sessionID: "ses_synthetic_run",
  error: { name: "APIError", data: { message: "refused" } },
});

const stdinText = (spawned: FakeSpawner.Spawned) => {
  const stdin = spawned.options.stdin;
  return Stream.isStream(stdin) ? Stream.mkString(Stream.decodeText(stdin)) : Effect.succeed("");
};

describe("OpenCode happy path", () => {
  it.effect(
    "spawns opencode run with the model and json format, a scratch dir of shims, the env, and the prompt on stdin",
    () =>
      Effect.gen(function* () {
        const spawner = FakeSpawner.fakeSpawner(() => ({
          exitCode: 0,
          stdout: `${TEXT_LINE}\n`,
        }));
        const fs = memoryFs();
        const runner = yield* Runner.AgentRunner.pipe(
          Effect.provide(env(spawner, fs, FakeLog.fakeLog())),
        );
        expect(runner.name).toBe("opencode");
        expect(runner.model).toBe(OpenCode.MODEL);
        const scope = yield* Scope.make();
        const outcome = yield* runner.run({ key: KEY, prompt: PROMPT }).pipe(Scope.provide(scope));
        expect(outcome).toEqual({ session: "ses_synthetic_run", text: "done" });
        expect(spawner.spawned).toHaveLength(1);
        const spawned = spawner.spawned[0];
        expect(spawned).toBeDefined();
        if (spawned === undefined) {
          return;
        }
        expect(spawned.command).toBe(OpenCode.BIN);
        expect(spawned.args).toEqual(["run", "--model", OpenCode.MODEL, "--format", "json"]);
        expect(spawned.options.extendEnv).toBe(true);
        expect(spawned.options.killSignal).toBe("SIGTERM");
        expect(spawned.options.forceKillAfter).toBe("5 seconds");
        expect(spawned.args.join(" ")).not.toContain(TOKEN);
        expect(spawned.args.join(" ")).not.toContain(DATABASE_URL);
        expect(spawned.options.env).toEqual({
          OLIGARCHY_TOKEN: TOKEN,
          DATABASE_URL,
          OLIGARCHY_MODEL: OpenCode.MODEL,
        });
        expect(yield* stdinText(spawned)).toBe(PROMPT);
        const dir = spawned.options.cwd;
        expect(dir).toMatch(/oligarchy-run-/);
        if (dir === undefined) {
          return;
        }
        for (const name of ["client", "client-with-image", "ctrl", "session"] as const) {
          const shim = fs.files.get(`${dir}/${name}`);
          expect(shim?.mode).toBe(0o700);
          expect(shim?.data).toMatch(new RegExp(`^#!/bin/sh\\nexec "/.+/${name}" "\\$@"\\n$`));
        }
        const config = fs.files.get(`${dir}/opencode.json`);
        expect(config?.mode).toBe(0o600);
        expect(JSON.parse(config?.data ?? "{}")).toMatchObject({
          permission: {
            bash: {
              "*": "deny",
              "./client*": "allow",
              "./client-with-image*": "allow",
              "./ctrl*": "allow",
              "./session*": "allow",
              "sleep*": "allow",
            },
            edit: "deny",
            write: "deny",
            webfetch: "deny",
            read: "allow",
          },
        });
        yield* Scope.close(scope, Exit.void);
        expect(fs.removed).toContain(dir);
        expect(fs.files.size).toBe(0);
      }),
  );

  it.effect("ignores a stdout line that is not JSON and still answers the session", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 0,
        stdout: `noise\n${TEXT_LINE}\n`,
      }));
      const runner = yield* Runner.AgentRunner.pipe(
        Effect.provide(env(spawner, memoryFs(), FakeLog.fakeLog())),
      );
      const outcome = yield* runner.run({ key: KEY, prompt: PROMPT });
      expect(outcome).toEqual({ session: "ses_synthetic_run", text: "done" });
    }),
  );
});

describe("OpenCode unhappy path", () => {
  it.effect("exit 1 with an error event is RunFailed naming that message", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 1,
        stdout: `${ERROR_LINE}\n`,
      }));
      const runner = yield* Runner.AgentRunner.pipe(
        Effect.provide(env(spawner, memoryFs(), FakeLog.fakeLog())),
      );
      const error = yield* Effect.flip(runner.run({ key: KEY, prompt: PROMPT }));
      expect(error).toMatchObject({
        _tag: "RunFailed",
        message: "opencode: exited 1: refused",
        agentId: KEY,
      });
    }),
  );

  it.effect("exit 1 without an error event carries the stderr tail", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 1,
        stderr: "  boom from opencode\n",
      }));
      const runner = yield* Runner.AgentRunner.pipe(
        Effect.provide(env(spawner, memoryFs(), FakeLog.fakeLog())),
      );
      const error = yield* Effect.flip(runner.run({ key: KEY, prompt: PROMPT }));
      expect(error).toMatchObject({
        _tag: "RunFailed",
        message: "opencode: exited 1: boom from opencode",
        agentId: KEY,
      });
    }),
  );

  it.effect("exit 0 without a session is RunFailed", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0, stdout: "noise\n" }));
      const runner = yield* Runner.AgentRunner.pipe(
        Effect.provide(env(spawner, memoryFs(), FakeLog.fakeLog())),
      );
      const error = yield* Effect.flip(runner.run({ key: KEY, prompt: PROMPT }));
      expect(error).toMatchObject({
        _tag: "RunFailed",
        message: "opencode: exited 0 without a session",
        agentId: KEY,
      });
    }),
  );

  it.effect("a spawn ENOENT is RunFailed and the rendered error contains no key", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        spawnError: "spawn opencode ENOENT",
      }));
      const runner = yield* Runner.AgentRunner.pipe(
        Effect.provide(env(spawner, memoryFs(), FakeLog.fakeLog())),
      );
      const error = yield* Effect.flip(runner.run({ key: KEY, prompt: PROMPT }));
      expect(error).toMatchObject({
        _tag: "RunFailed",
        message: "opencode: spawn opencode ENOENT",
        agentId: KEY,
      });
      const rendered = Render.headline(error);
      expect(rendered).toMatch(/^opencode: spawn opencode ENOENT/);
      expect(rendered).not.toContain(KEY);
      expect(rendered).not.toContain(TOKEN);
      expect(rendered).not.toContain("sentinel-db-pw");
    }),
  );

  it.effect("a signal death nobody asked for is RunFailed with the platform's sentence", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const runner = yield* Runner.AgentRunner.pipe(
        Effect.provide(env(spawner, memoryFs(), FakeLog.fakeLog())),
      );
      const fiber = yield* Effect.forkChild(runner.run({ key: KEY, prompt: PROMPT }));
      yield* Effect.yieldNow;
      yield* spawner.spawned[0]?.die("SIGKILL") ?? Effect.void;
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toMatch(/^opencode: /);
      expect(error.message).toContain("Process interrupted due to receipt of signal");
      expect(error.agentId).toBe(KEY);
    }),
  );

  it.effect(
    "closing the scope mid-run records SIGTERM on the child and removes the directory",
    () =>
      Effect.gen(function* () {
        const spawner = FakeSpawner.fakeSpawner(() => ({}));
        const fs = memoryFs();
        const runner = yield* Runner.AgentRunner.pipe(
          Effect.provide(env(spawner, fs, FakeLog.fakeLog())),
        );
        const scope = yield* Scope.make();
        yield* runner
          .run({ key: KEY, prompt: PROMPT })
          .pipe(Scope.provide(scope), Effect.forkChild);
        yield* Effect.yieldNow;
        const dir = spawner.spawned[0]?.options.cwd;
        expect(dir).toBeDefined();
        yield* Scope.close(scope, Exit.void);
        expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
        expect(fs.removed).toContain(dir);
      }),
  );
});
