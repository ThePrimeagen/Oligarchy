import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Duration, Effect, Fiber, Layer, Schedule } from "effect";
import { TestClock } from "effect/testing";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Cli from "../../src/cli.ts";
import * as FakeLog from "../support/log.ts";

// Sessions over the real spawner and a real stand-in opencode, on the test clock: the signals are
// real, the force-kill deadline is TestClock's, so a five-second wait costs nothing.
const TICKET = "OLI-42";
const MODEL = "opencode/muse-spark-1.3-contributor-free";
const FORCE_KILL_MS = Duration.toMillis(Cli.FORCE_KILL_AFTER);

let bin = "";
let originalPath = "";

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "oligarchy-opencode-"));
  originalPath = process.env.PATH ?? "";
  process.env.PATH = `${bin}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(bin, { recursive: true, force: true });
});

// The stand-in writes its pid once `prelude` has run, then becomes the sleep, so the pid is the
// process the abort signals and nothing it started outlives it.
const installOpencode = (prelude: string): string => {
  const pidFile = join(bin, "opencode.pid");
  const file = join(bin, "opencode");
  writeFileSync(file, `#!/bin/sh\n${prelude}\necho $$ > "${pidFile}"\nexec sleep 60\n`);
  chmodSync(file, 0o755);
  return pidFile;
};

// 0 until the stand-in has written its pid.
const pidIn = (pidFile: string): number =>
  existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;

// A real process starting, so a wait on the live clock.
const started = (pidFile: string) =>
  TestClock.withLive(
    Effect.sync(() => pidIn(pidFile)).pipe(
      Effect.repeat({ until: (pid) => pid > 0, schedule: Schedule.spaced("5 millis") }),
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.die("the stand-in opencode never started"),
      }),
    ),
  );

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// After a failed expectation the run's scope kills the stand-in, and that kill's deadline is on a
// test clock nothing moves any more; a stand-in that ignores SIGTERM is SIGKILLed here instead.
const reap = (pidFile: string) =>
  Effect.sync(() => {
    const pid = pidIn(pidFile);
    try {
      if (pid > 0) process.kill(pid, "SIGKILL");
    } catch {
      // ESRCH: it has already exited.
    }
  });

const layer = () =>
  Sessions.Sessions.layer(
    1,
    () => Effect.void,
    () => Effect.void,
  ).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, FakeLog.fakeLog().layer)));

describe("Sessions.abort against a real opencode", () => {
  it.effect("ends an opencode that exits on SIGTERM without the clock moving", () => {
    const pidFile = installOpencode("");
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "diagnose");
      const running = yield* Effect.forkChild(
        Effect.flip(sessions.run(TICKET, "do the work", MODEL)),
      );
      const pid = yield* started(pidFile);
      yield* sessions.abort(TICKET);
      expect(alive(pid)).toBe(false);
      expect(yield* Fiber.join(running)).toMatchObject({
        _tag: "RunFailed",
        message: expect.stringContaining("SIGTERM"),
      });
    }).pipe(Effect.provide(layer()));
  });

  it.effect(
    "SIGKILLs an opencode that ignores SIGTERM at the force-kill deadline, not before",
    () => {
      const pidFile = installOpencode('trap "" TERM');
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "diagnose");
        const running = yield* Effect.forkChild(
          Effect.flip(sessions.run(TICKET, "do the work", MODEL)),
        );
        const pid = yield* started(pidFile);
        // Started at once, so SIGTERM is sent and the deadline is on the test clock before it moves.
        const aborting = yield* Effect.forkChild(sessions.abort(TICKET), {
          startImmediately: true,
        });
        yield* TestClock.adjust(Duration.millis(FORCE_KILL_MS - 1));
        // A SIGKILL sent early lands in real time: the abort would finish well within this window.
        const early = yield* TestClock.withLive(
          Fiber.await(aborting).pipe(
            Effect.timeoutOrElse({
              duration: "50 millis",
              orElse: () => Effect.succeed("waiting"),
            }),
          ),
        );
        expect(early).toBe("waiting");
        expect(alive(pid)).toBe(true);
        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(aborting);
        expect(alive(pid)).toBe(false);
        expect(yield* Fiber.join(running)).toMatchObject({
          _tag: "RunFailed",
          message: expect.stringContaining("SIGKILL"),
        });
      }).pipe(Effect.ensuring(reap(pidFile)), Effect.provide(layer()));
    },
  );
});
