import { existsSync } from "node:fs";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ProcessUsage from "../src/process.ts";

// A child holding this much, so a reading that missed the descendants would be off by far more
// than the two readings may drift apart.
const HELD_BYTES = 64 * 1024 * 1024;
// This process allocates between the two readings (ps's pipes, the samples themselves).
const DRIFT_BYTES = 4 * 1024 * 1024;

// Both sources run on Linux, where both ps and /proc exist; macOS has no /proc to compare with.
describe.skipIf(!existsSync("/proc/self/stat"))("ps and /proc on one host", () => {
  it.live("read the same resident memory for this process and its children, and the same cpu", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            "-e",
            `const held = Buffer.alloc(${String(HELD_BYTES)}, 1); console.log("held"); setInterval(() => { held[0] += 1; }, 1000);`,
          ],
          { stdin: "ignore", stderr: "ignore" },
        ),
      );
      yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.take(1),
        Stream.runDrain,
      );
      const proc = yield* Effect.flatMap(ProcessUsage.procSource, ProcessUsage.ProcessUsage.make);
      const ps = yield* ProcessUsage.ProcessUsage.make(
        ProcessUsage.psSource(
          process.pid,
          () => process.cpuUsage(),
          ProcessUsage.listProcesses.pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        ),
      );

      const fromProc = yield* proc.collect;
      const fromPs = yield* ps.collect;
      expect(fromProc.memoryBytes).toBeGreaterThan(HELD_BYTES);
      expect(Math.abs(fromPs.memoryBytes - fromProc.memoryBytes)).toBeLessThan(DRIFT_BYTES);

      // Half a second of this pid busy, in both windows.
      yield* Effect.sync(() => {
        const until = performance.now() + 500;
        while (performance.now() < until) {
          // spin
        }
      });
      const busyProc = yield* proc.collect;
      const busyPs = yield* ps.collect;
      expect(busyProc.cpuPercent).toBeGreaterThan(50);
      expect(Math.abs(busyPs.cpuPercent - busyProc.cpuPercent)).toBeLessThan(10);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
