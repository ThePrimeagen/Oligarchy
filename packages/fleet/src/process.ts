import { Clock, Context, Effect, FileSystem, Layer, Option, Ref, Schema, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ExternalFailure from "@oligarchy/log/external-failure";

// USER_HZ on Linux: /proc/self/stat counts in these ticks, and macOS's microseconds are read as
// them so both hosts share one window.
const CLK_TCK = 100;

export type Reading = {
  readonly cpuTicks: number;
  readonly memoryBytes: number;
};

export type ProcessSample = {
  readonly memoryBytes: number;
  readonly cpuPercent: number;
};

// macOS's ps could not be run, did not answer, or did not list this process.
export class PsFailed extends Schema.TaggedError<PsFailed>("@oligarchy/fleet/process/PsFailed")(
  "PsFailed",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export type Source = () => Effect.Effect<Reading, PsFailed>;

export type ProcessUsageService = {
  readonly collect: Effect.Effect<ProcessSample, PsFailed>;
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

// QEMU and ./driver hold the RAM this Node process does not. Walk every task's children
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

export const procSource: Effect.Effect<Source, never, FileSystem.FileSystem> = Effect.gen(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    return () =>
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
        // report 0. Memory is the tree, so a qemu or driver the dashboard cannot see is counted.
        const childrenBytes = yield* descendantsMemory(fs, "self");
        return { cpuTicks, memoryBytes: memoryBytes + childrenBytes };
      });
  },
);

// macOS has no /proc. ps reads each pid's resident size, the counter VmRSS is on Linux, in KiB as
// VmRSS is; an empty header on every column prints no header line.
const PS = "/bin/ps";
const PS_ARGS = ["-A", "-o", "pid=", "-o", "ppid=", "-o", "rss="];
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/gm;
// ps answers in milliseconds; one that wedges must not hold every later heartbeat with it, and
// it has nothing to flush, so SIGTERM gets a second before SIGKILL.
const PS_TIMEOUT = "10 seconds";
const PS_FORCE_KILL_AFTER = "1 second";

// What one ps printed, and its own pid: it is root's child for its moment.
export type Listing = {
  readonly text: string;
  readonly ps: number;
};

// The rss of `root` and every descendant, as the /proc walk sums them. The ps that printed the
// listing is left out: /proc is read without one.
const treeRssBytes = (listing: Listing, root: number): Option.Option<number> => {
  const rss = new Map<number, number>();
  const children = new Map<number, Array<number>>();
  for (const [, pid, ppid, kb] of listing.text.matchAll(PS_ROW)) {
    if (Number(pid) === listing.ps) {
      continue;
    }
    rss.set(Number(pid), Number(kb) * 1024);
    children.set(Number(ppid), [...(children.get(Number(ppid)) ?? []), Number(pid)]);
  }
  if (!rss.has(root)) {
    return Option.none();
  }
  // The listing is not one snapshot: a pid reused while ps ran could close a loop.
  const seen = new Set<number>();
  let total = 0;
  const visit = (pid: number): void => {
    if (seen.has(pid)) {
      return;
    }
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    for (const child of children.get(pid) ?? []) {
      visit(child);
    }
  };
  visit(root);
  return Option.some(total);
};

// Every process with its parent and rss, as ps lists them.
export const listProcesses: Effect.Effect<
  Listing,
  PsFailed,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(PS, PS_ARGS, {
      stdin: "ignore",
      stderr: "ignore",
      detached: false,
      killSignal: "SIGTERM",
      forceKillAfter: PS_FORCE_KILL_AFTER,
    }),
  );
  const text = yield* Stream.mkString(Stream.decodeText(handle.stdout));
  return { text, ps: handle.pid };
}).pipe(
  Effect.scoped,
  // Node's own reason (`spawn /bin/ps EAGAIN`), not the PlatformError wrapper's.
  Effect.mapError((error) =>
    PsFailed.make({
      message: ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), error.message),
      cause: error,
    }),
  ),
  Effect.timeoutOrElse({
    duration: PS_TIMEOUT,
    orElse: () => Effect.fail(PsFailed.make({ message: `ps did not answer within ${PS_TIMEOUT}` })),
  }),
);

// `cpuUsage` is getrusage's user and system microseconds for this pid, what utime and stime
// count in /proc/self/stat, so the cpu stays this pid as it does on Linux.
export const psSource =
  (
    pid: number,
    cpuUsage: () => { readonly user: number; readonly system: number },
    list: Effect.Effect<Listing, PsFailed>,
  ): Source =>
  () =>
    Effect.gen(function* () {
      const { user, system } = cpuUsage();
      const listing = yield* list;
      const memoryBytes = Option.getOrUndefined(treeRssBytes(listing, pid));
      if (memoryBytes === undefined) {
        return yield* PsFailed.make({
          message: `ps did not list this process (pid ${String(pid)})`,
        });
      }
      return { cpuTicks: ((user + system) * CLK_TCK) / 1_000_000, memoryBytes };
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

export class ProcessUsage extends Context.Service<ProcessUsage>()("@oligarchy/fleet/ProcessUsage", {
  make,
}) {
  static readonly layer: Layer.Layer<
    ProcessUsage,
    never,
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  > = Layer.effect(this)(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const source =
        process.platform === "darwin"
          ? psSource(
              process.pid,
              () => process.cpuUsage(),
              Effect.provideService(
                listProcesses,
                ChildProcessSpawner.ChildProcessSpawner,
                spawner,
              ),
            )
          : yield* procSource;
      return yield* make(source);
    }),
  );
}
