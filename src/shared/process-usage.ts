import { Clock, Context, Effect, FileSystem, Layer, Option, Ref } from "effect";

// USER_HZ on Linux, and this process only runs there. /proc/self/stat counts in these ticks.
const CLK_TCK = 100;

export type Reading = {
  readonly cpuTicks: number;
  readonly memoryBytes: number;
};

export type ProcessSample = {
  readonly memoryBytes: number;
  readonly cpuPercent: number;
};

export type Source = () => Effect.Effect<Reading>;

export type ProcessUsageService = {
  readonly collect: Effect.Effect<ProcessSample>;
};

// After the last `)` of comm, fields are 3-indexed from state. utime is 14, stime is 15.
const TICK_OFFSET = 11;

const parseCpuTicks = (stat: string): Option.Option<number> => {
  const close = stat.lastIndexOf(")");
  if (close < 0) {
    return Option.none();
  }
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const utime = Number(fields[TICK_OFFSET]);
  const stime = Number(fields[TICK_OFFSET + 1]);
  return Number.isFinite(utime) && Number.isFinite(stime)
    ? Option.some(utime + stime)
    : Option.none();
};

const parseVmRssBytes = (status: string): Option.Option<number> => {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  if (match === null) {
    return Option.none();
  }
  const kb = Number(match[1]);
  return Number.isFinite(kb) ? Option.some(kb * 1024) : Option.none();
};

const parseChildren = (text: string): ReadonlyArray<string> => {
  const pids: Array<string> = [];
  for (const token of text.trim().split(/\s+/)) {
    if (/^\d+$/.test(token)) {
      pids.push(token);
    }
  }
  return pids;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

type Sample = {
  readonly reading: Reading;
  readonly at: bigint;
};

const missing = (path: string): Error => new Error(`unreadable process usage: ${path}`);

// QEMU and OpenCode hold the RAM this Node process does not. Walk every task's children
// file; a pid with no VmRSS is skipped for the sum, but we still walk its children so a
// grandchild that answers is counted. A missing /proc is not a defect of us.
const descendantsMemory = (fs: FileSystem.FileSystem, root: string): Effect.Effect<number> =>
  Effect.gen(function* () {
    const seen = new Set<string>([root]);
    let total = 0;
    const visit = (pid: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const tasks = yield* Effect.option(fs.readDirectory(`/proc/${pid}/task`));
        if (Option.isNone(tasks)) {
          return;
        }
        for (const tid of tasks.value) {
          const text = yield* fs
            .readFileString(`/proc/${pid}/task/${tid}/children`)
            .pipe(Effect.orElseSucceed(() => ""));
          for (const child of parseChildren(text)) {
            if (seen.has(child)) {
              continue;
            }
            seen.add(child);
            const status = yield* Effect.option(fs.readFileString(`/proc/${child}/status`));
            if (Option.isSome(status)) {
              const bytes = Option.getOrUndefined(parseVmRssBytes(status.value));
              if (bytes !== undefined) {
                total += bytes;
              }
            }
            yield* visit(child);
          }
        }
      });
    yield* visit(root);
    return total;
  });

const procSource =
  (fs: FileSystem.FileSystem): Source =>
  () =>
    Effect.gen(function* () {
      const statPath = "/proc/self/stat";
      const statusPath = "/proc/self/status";
      const stat = yield* fs.readFileString(statPath).pipe(Effect.orDie);
      const status = yield* fs.readFileString(statusPath).pipe(Effect.orDie);
      const cpuTicks = Option.getOrUndefined(parseCpuTicks(stat));
      const memoryBytes = Option.getOrUndefined(parseVmRssBytes(status));
      if (cpuTicks === undefined) {
        return yield* Effect.die(missing(statPath));
      }
      if (memoryBytes === undefined) {
        return yield* Effect.die(missing(statusPath));
      }
      // cpu stays this pid: children appear and vanish with each job, and lost ticks would
      // report 0. Memory is the tree, so a qemu or opencode the dashboard cannot see is counted.
      const childrenBytes = yield* descendantsMemory(fs, "self");
      return { cpuTicks, memoryBytes: memoryBytes + childrenBytes };
    });

const make = (source: Source): Effect.Effect<ProcessUsageService> =>
  Effect.gen(function* () {
    const last = yield* Ref.make<Option.Option<Sample>>(Option.none());

    const collect = Effect.gen(function* () {
      const reading = yield* source();
      const at = yield* Clock.monotonicTimeNanos;
      const previous = yield* Ref.get(last);
      yield* Ref.set(last, Option.some({ reading, at }));
      return Option.match(previous, {
        onNone: (): ProcessSample => ({ memoryBytes: reading.memoryBytes, cpuPercent: 0 }),
        onSome: (sample): ProcessSample => {
          const elapsedNs = at - sample.at;
          const deltaTicks = reading.cpuTicks - sample.reading.cpuTicks;
          // No time, or ticks went backwards (a wrap the contract does not name): report 0.
          if (elapsedNs <= 0n || deltaTicks < 0) {
            return { memoryBytes: reading.memoryBytes, cpuPercent: 0 };
          }
          // ticks / CLK_TCK / seconds * 100.
          return {
            memoryBytes: reading.memoryBytes,
            cpuPercent: round1((deltaTicks * 1e9 * 100) / (CLK_TCK * Number(elapsedNs))),
          };
        },
      });
    }).pipe(Effect.withSpan("ProcessUsage.collect"));

    return { collect } satisfies ProcessUsageService;
  });

export class ProcessUsage extends Context.Service<ProcessUsage>()(
  "@oligarchy/shared/ProcessUsage",
  { make },
) {
  static readonly layer: Layer.Layer<ProcessUsage, never, FileSystem.FileSystem> = Layer.effect(
    this,
  )(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* make(procSource(fs));
    }),
  );
}
