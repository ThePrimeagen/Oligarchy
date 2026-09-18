import {
  type CliRenderer,
  type CliRendererErrorEvent,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core";
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Schedule,
  type Scope,
  Stream,
} from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { createSignal } from "solid-js";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Config from "../config.ts";
import * as Actions from "../db/actions.ts";
import * as Automation from "../db/automation.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Follow from "./follow.ts";
import * as Screen from "./screen.tsx";
import * as View from "./view.ts";

// Linear resolves a ticket by its identifier alone and redirects into the workspace.
const LINEAR_ISSUES = "https://linear.app/issue/";

// The desktop's opener, on the Linux boxes viz is watched from. It hands the url to the browser
// and exits 0 at once, exits non-zero when nothing handles it, or, in a bare session, runs the
// browser in its foreground and exits with it: two seconds without an exit is the browser up.
const OPENER = "xdg-open";
const OPEN_WAIT = Duration.seconds(2);

// The spinner on a followed session's running entries turns this often.
const SPIN = Duration.millis(80);

// The screen the view draws on: OpenTUI's renderer, which takes the alternate screen and raw
// mode when opened and hands both back when the scope it was opened in closes. The signals stay
// runMain's, so SIGTERM interrupts the root fiber and the release restores the terminal; ctrl-c
// arrives as a key in raw mode and ends the view the same way q does. The mouse is left to the
// terminal, so its own selection still works.
type Opener = {
  readonly open: Effect.Effect<CliRenderer, Errors.CommandError, Scope.Scope>;
};

export class Renderer extends Context.Service<Renderer, Opener>()("@oligarchy/viz/Renderer") {
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

// The session's last three commands and its last screenshot, as the database has them.
const loadPeek = (
  ticket: string,
  sessionId: string,
  serverUrl: string | null,
): Effect.Effect<Follow.Peek, Errors.DatabaseError, Actions.ActionStore> =>
  Effect.gen(function* () {
    const actions = yield* Actions.ActionStore;
    const rows = yield* actions.listActions(sessionId);
    const images = yield* actions.listImages(sessionId);
    const last = images.at(-1);
    const png = last === undefined ? Option.none<Uint8Array>() : yield* actions.getImage(last.id);
    return Follow.peekFromActions(ticket, sessionId, serverUrl, rows, png);
  });

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

// A frame that throws is OpenTUI's word that the screen is broken, and left unanswered it would
// open its console over the view and draw the frame again: the run ends with the reason instead.
const drawFailure = (renderer: CliRenderer): Effect.Effect<never, Errors.CommandError> =>
  Effect.callback<never, Errors.CommandError>((resume) => {
    const onError = ({ error }: CliRendererErrorEvent) => {
      resume(
        Effect.fail(
          Errors.CommandError.make({ message: `viz could not draw the screen: ${error.message}` }),
        ),
      );
    };
    renderer.once("render:error", onError);
    return Effect.sync(() => {
      renderer.off("render:error", onError);
    });
  });

// Owns the screen while it runs: the state lives in two Solid signals the screen redraws from,
// so a read, a tick of the ages or a key changes the signal and the cells that changed are
// written. The tables are read at once and every REFRESH, the clock the ages count from is set
// at the first frame and every AGE_TICK, L opens the selected job's ticket first, F peeks at the
// selected running job and follows it live on a second F, and q or ctrl-c ends the run and the
// scope hands the screen back. A read that fails leaves the last picture up with its reason on
// the footer; a frame that fails ends the run.
export const run: Effect.Effect<
  void,
  Errors.CommandError,
  | Renderer
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Automation.AutomationStore
  | Actions.ActionStore
> = Effect.gen(function* () {
  const screen = yield* Renderer;
  const servers = yield* Servers.ServerStore;
  const processStats = yield* ProcessStats.ProcessStatsStore;
  const automation = yield* Automation.AutomationStore;
  const [view, setView] = createSignal<View.View>(View.initialView);
  const [now, setNow] = createSignal(yield* Clock.currentTimeMillis);
  const setNotice = (text: string) =>
    Effect.sync(() => {
      setView((current) => ({ ...current, notice: Option.some(text) }));
    });
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
    yield* setNotice(notice);
  });
  // The follow's work off the key loop, one piece at a time: the peek's reads on the first F,
  // the connect and the stream on the second. The reads clear themselves once the peek is up,
  // the stream stays until the escape that closes the follow, a failure clears itself into a
  // notice, and any key that leaves nothing followed interrupts what is in flight, so a database
  // or a server that never answers holds no key.
  const followFiber = yield* Ref.make(Option.none<Fiber.Fiber<void>>());
  const stopFollow = Effect.gen(function* () {
    const running = yield* Ref.getAndSet(followFiber, Option.none());
    if (Option.isSome(running)) {
      yield* Fiber.interrupt(running.value);
    }
  });
  const withFull = (change: (follow: Follow.Full) => Follow.Full) =>
    Effect.sync(() => {
      setView((current) => {
        if (Option.isNone(current.follow) || current.follow.value._tag !== "full") {
          return current;
        }
        return { ...current, follow: Option.some(change(current.follow.value)) };
      });
    });
  const spin = withFull(Follow.tick);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const renderer = yield* screen.open;
      yield* Effect.promise(() => Screen.mount(renderer, { view, now }));
      const startFollow = <R>(work: Effect.Effect<void, never, R>) =>
        Effect.gen(function* () {
          if (Option.isSome(yield* Ref.get(followFiber))) {
            return;
          }
          const fiber = yield* Effect.forkScoped(work);
          yield* Ref.set(followFiber, Option.some(fiber));
        });
      // What a piece of follow work fails into: its reason on the footer, and room for the next F.
      const failing = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
        Effect.catchCause(Effect.asVoid(work), (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.andThen(
                setNotice(Render.headline(Cause.squash(cause))),
                Ref.set(followFiber, Option.none()),
              ),
        );
      // The first F: the job's last commands and screenshot, read from the database.
      const peekWork = (job: Automation.AutomationJobListRow) =>
        failing(
          Effect.gen(function* () {
            const peek = yield* loadPeek(
              job.ticket ?? "—",
              Option.getOrThrow(Option.fromNullishOr(job.sessionId)),
              job.serverUrl,
            );
            setView((latest) => ({ ...latest, follow: Option.some(peek), notice: Option.none() }));
            yield* Ref.set(followFiber, Option.none());
          }),
        );
      // The second F: the qemu server streams the session, and every event lands on the full
      // screen as it arrives. A stream that ends with the session still going was dropped by
      // the server, which keeps one follower at a time and the newest.
      const streamWork = (peek: Follow.Peek, serverUrl: string) =>
        failing(
          Effect.gen(function* () {
            const token = yield* Config.oligarchyToken;
            const proxy = yield* ProxyClient.connect({ serverUrl, token });
            const bytes = yield* proxy.follow(peek.sessionId);
            setView((current) => ({
              ...current,
              follow: Option.some(Follow.expand(peek, serverUrl)),
              notice: Option.none(),
            }));
            yield* Stream.splitLines(Stream.decodeText(bytes)).pipe(
              Stream.filter((line) => line !== ""),
              Stream.runForEach((line) =>
                Effect.andThen(Domain.decodeFollowLine(line).pipe(Effect.orDie), (event) =>
                  withFull((follow) => Follow.apply(follow, event)),
                ),
              ),
            );
            const latest = view();
            if (
              Option.isSome(latest.follow) &&
              latest.follow.value._tag === "full" &&
              (latest.follow.value.status === "pending" || latest.follow.value.status === "running")
            ) {
              yield* setNotice(`dropped from ${peek.sessionId}: this follower fell behind`);
            }
          }),
        );
      // F: nothing more on a full follow, the stream on a peek, else the selected job's peek.
      const openFollow = Effect.gen(function* () {
        const current = view();
        if (Option.isSome(current.follow)) {
          if (current.follow.value._tag === "peek") {
            const serverUrl = Option.getOrNull(current.follow.value.serverUrl);
            if (serverUrl === null) {
              yield* setNotice("follow needs a qemu server");
              return;
            }
            yield* startFollow(streamWork(current.follow.value, serverUrl));
          }
          return;
        }
        const job = View.selectedJob(current);
        const refused = View.followError(job);
        if (Option.isSome(refused)) {
          yield* setNotice(refused.value);
          return;
        }
        yield* startFollow(peekWork(Option.getOrThrow(job)));
      });
      const keys = keysOf(renderer).pipe(
        Stream.takeWhile((key) => !View.isQuit(key)),
        Stream.runForEach((key) =>
          Effect.gen(function* () {
            setView((current) => View.press(current, key));
            if (Option.isNone(view().follow)) {
              yield* stopFollow;
            }
            if (View.isOpen(key)) {
              yield* open;
            }
            if (View.isFollow(key)) {
              yield* openFollow;
            }
          }),
        ),
      );
      yield* Effect.raceAllFirst([
        keys,
        Effect.repeat(read, Schedule.spaced(View.REFRESH)),
        Effect.repeat(tick, Schedule.spaced(View.AGE_TICK)),
        Effect.repeat(spin, Schedule.spaced(SPIN)),
        drawFailure(renderer),
      ]);
    }),
  );
});
