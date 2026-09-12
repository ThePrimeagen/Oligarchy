import { Clock, Context, Effect, FileSystem, Layer, Option, Ref } from "effect";

// USER_HZ on Linux, and this process only runs there. /proc/self/stat counts in these ticks.
export const CLK_TCK = 100;
export const STAT_PATH = "/proc/self/stat";
export const STATUS_PATH = "/proc/self/status";

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

export const parseCpuTicks = (stat: string): Option.Option<number> => {
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

export const parseVmRssBytes = (status: string): Option.Option<number> => {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  if (match === null) {
    return Option.none();
  }
  const kb = Number(match[1]);
  return Number.isFinite(kb) ? Option.some(kb * 1024) : Option.none();
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

type Sample = {
  readonly reading: Reading;
  readonly at: number;
};

const missing = (path: string): Error => new Error(`unreadable process usage: ${path}`);

export const procSource =
  (fs: FileSystem.FileSystem): Source =>
  () =>
    Effect.gen(function* () {
      const stat = yield* fs.readFileString(STAT_PATH).pipe(Effect.orDie);
      const status = yield* fs.readFileString(STATUS_PATH).pipe(Effect.orDie);
      const cpuTicks = Option.getOrUndefined(parseCpuTicks(stat));
      const memoryBytes = Option.getOrUndefined(parseVmRssBytes(status));
      if (cpuTicks === undefined) {
        return yield* Effect.die(missing(STAT_PATH));
      }
      if (memoryBytes === undefined) {
        return yield* Effect.die(missing(STATUS_PATH));
      }
      return { cpuTicks, memoryBytes };
    });

const make = (source: Source): Effect.Effect<ProcessUsageService> =>
  Effect.gen(function* () {
    const last = yield* Ref.make<Option.Option<Sample>>(Option.none());

    const collect = Effect.gen(function* () {
      const reading = yield* source();
      const at = yield* Clock.currentTimeMillis;
      const previous = yield* Ref.get(last);
      yield* Ref.set(last, Option.some({ reading, at }));
      return Option.match(previous, {
        onNone: (): ProcessSample => ({ memoryBytes: reading.memoryBytes, cpuPercent: 0 }),
        onSome: (sample): ProcessSample => {
          const elapsedMs = at - sample.at;
          const deltaTicks = reading.cpuTicks - sample.reading.cpuTicks;
          // No time, or ticks went backwards (a wrap the contract does not name): report 0.
          if (elapsedMs <= 0 || deltaTicks < 0) {
            return { memoryBytes: reading.memoryBytes, cpuPercent: 0 };
          }
          // ticks / CLK_TCK / seconds * 100 = ticks * 1000 / elapsedMs at USER_HZ 100.
          return {
            memoryBytes: reading.memoryBytes,
            cpuPercent: round1((deltaTicks * 1_000) / elapsedMs),
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
