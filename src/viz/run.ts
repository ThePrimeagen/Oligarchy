import { type CliRenderer, createCliRenderer, type KeyEvent } from "@opentui/core";
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Queue,
  Schedule,
  type Scope,
  Stream,
} from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { createSignal } from "solid-js";
import * as Automation from "../db/automation.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Screen from "./screen.tsx";
import * as View from "./view.ts";

// Linear resolves a ticket by its identifier alone and redirects into the workspace.
const LINEAR_ISSUES = "https://linear.app/issue/";

// The desktop's opener, on the Linux boxes viz is watched from. It hands the url to the browser
// and exits 0 at once, exits non-zero when nothing handles it, or, in a bare session, runs the
// browser in its foreground and exits with it: two seconds without an exit is the browser up.
const OPENER = "xdg-open";
const OPEN_WAIT = Duration.seconds(2);

// The screen the view draws on: OpenTUI's renderer, which takes the alternate screen and raw
// mode when opened and hands both back when the scope it was opened in closes. The signals stay
// runMain's, so SIGTERM interrupts the root fiber and the release restores the terminal; ctrl-c
// arrives as a key in raw mode and ends the view the same way q does. The mouse is left to the
// terminal, so its own selection still works.
export class Renderer extends Context.Service<
  Renderer,
  { readonly open: Effect.Effect<CliRenderer, Errors.CommandError, Scope.Scope> }
>()("@oligarchy/viz/Renderer") {
  static readonly layer: Layer.Layer<Renderer> = Layer.succeed(this)(
    this.of({
      open: Effect.acquireRelease(
        Effect.tryPromise({
          try: () => createCliRenderer({ exitOnCtrlC: false, exitSignals: [], useMouse: false }),
          catch: (cause) =>
            Errors.CommandError.make({
              message: `viz could not open the screen: ${Render.errorDetail(cause)}`,
            }),
        }),
        (renderer) =>
          Effect.sync(() => {
            renderer.destroy();
          }),
      ),
    }),
  );
}

// Hands the ticket's url to the opener and says what came of it. The browser is the desktop's:
// it gets the desktop's environment, none of this screen's stdio, its own process group, and
// the handle is unreferenced, so neither the bound nor q closing the scope kills it.
const openTicket = (
  ticket: string,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const url = `${LINEAR_ISSUES}${ticket}`;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(OPENER, [url], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        extendEnv: true,
        detached: true,
      }),
    );
    // The re-ref it hands back is never wanted: the browser is not ours to wait for.
    yield* Effect.asVoid(handle.unref);
    const code = yield* handle.exitCode.pipe(
      Effect.timeoutOrElse({ duration: OPEN_WAIT, orElse: () => Effect.succeed(0) }),
    );
    return code === 0 ? `opened ${url}` : `${OPENER} exited ${String(code)}`;
  }).pipe(
    Effect.scoped,
    // Node's own message (`spawn xdg-open ENOENT`) behind the platform wrapper, else the wrapper's.
    Effect.catchTag("PlatformError", (error) =>
      Effect.succeed(
        `${OPENER}: ${ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error))}`,
      ),
    ),
  );

// The keys the screen's parser reports while the stream is consumed.
const keysOf = (renderer: CliRenderer): Stream.Stream<KeyEvent> =>
  Stream.callback<KeyEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const onKey = (key: KeyEvent) => {
          Queue.offerUnsafe(queue, key);
        };
        renderer.keyInput.on("keypress", onKey);
        return onKey;
      }),
      (onKey) =>
        Effect.sync(() => {
          renderer.keyInput.off("keypress", onKey);
        }),
    ),
  );

// Owns the screen while it runs: the state lives in two Solid signals the screen redraws from,
// so a read, a tick of the ages or a key changes the signal and the cells that changed are
// written. The tables are read at once and every REFRESH, the clock the ages count from moves
// every AGE_TICK, L opens the selected job's ticket first, and q or ctrl-c ends the run and the
// scope hands the screen back. A read that fails leaves the last picture up with its reason on
// the footer.
export const run: Effect.Effect<
  void,
  Errors.CommandError,
  | Renderer
  | ChildProcessSpawner.ChildProcessSpawner
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Automation.AutomationStore
> = Effect.gen(function* () {
  const screen = yield* Renderer;
  const servers = yield* Servers.ServerStore;
  const processStats = yield* ProcessStats.ProcessStatsStore;
  const automation = yield* Automation.AutomationStore;
  const [view, setView] = createSignal<View.View>(View.initialView);
  const [now, setNow] = createSignal(yield* Clock.currentTimeMillis);
  const tick = Effect.andThen(Clock.currentTimeMillis, (ms) =>
    Effect.sync(() => {
      setNow(ms);
    }),
  );
  const read = Effect.gen(function* () {
    // Taken before the queries, so an age counts from before its row was read, never after: a
    // slow read leans towards silent, not live.
    const readAt = yield* Clock.currentTimeMillis;
    const machines = yield* servers.listMachines();
    const series = yield* processStats.listSeries(View.SERIES_SAMPLES);
    // No completed jobs: the screen shows what runs and what waits.
    const queue = yield* automation.listJobs(0);
    setView((current) => ({
      ...current,
      snapshot: Option.some({ machines, series, queue, readAt }),
      failure: Option.none(),
    }));
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.sync(() => {
            setView((current) => ({
              ...current,
              failure: Option.some(Render.headline(Cause.squash(cause))),
            }));
          }),
    ),
  );
  // L's notice lands after press retired the last one, so it is what the screen shows.
  const open = Effect.gen(function* () {
    const notice = yield* Option.match(View.selectedJob(view()), {
      onNone: () => Effect.succeed("no job selected"),
      onSome: (job) =>
        job.ticket === null
          ? Effect.succeed("the selected job has no ticket")
          : openTicket(job.ticket),
    });
    setView((current) => ({ ...current, notice: Option.some(notice) }));
  });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const renderer = yield* screen.open;
      yield* Effect.promise(() => Screen.mount(renderer, { view, now }));
      const keys = keysOf(renderer).pipe(
        Stream.takeWhile((key) => !View.isQuit(key)),
        Stream.runForEach((key) =>
          Effect.gen(function* () {
            setView((current) => View.press(current, key));
            if (View.isOpen(key)) {
              yield* open;
            }
          }),
        ),
      );
      yield* Effect.raceFirst(
        keys,
        Effect.raceFirst(
          Effect.repeat(read, Schedule.spaced(View.REFRESH)),
          Effect.schedule(tick, Schedule.spaced(View.AGE_TICK)),
        ),
      );
    }),
  );
});
