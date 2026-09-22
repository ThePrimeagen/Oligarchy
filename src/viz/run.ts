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
  Redacted,
  Ref,
  Result,
  Schedule,
  type Scope,
  Stream,
} from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { createSignal } from "solid-js";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Config from "../config.ts";
import * as Actions from "../db/actions.ts";
import * as Automation from "../db/automation.ts";
import * as Tests from "../db/tests.ts";
import type * as ProcessStats from "../db/process-stats.ts";
import type * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Follow from "./follow.ts";
import * as Read from "./read.ts";
import * as Screen from "./screen.tsx";
import * as Settings from "./settings.ts";
import * as View from "./view.ts";

// Linear resolves a ticket by its identifier alone and redirects into the workspace.
const LINEAR_ISSUES = "https://linear.app/issue/";

// The desktop's opener, on the Linux boxes viz is watched from. It hands the url to the browser
// and exits 0 at once, exits non-zero when nothing handles it, or, in a bare session, runs the
// browser in its foreground and exits with it: two seconds without an exit is the browser up.
const OPENER = "xdg-open";
const OPEN_WAIT = Duration.seconds(2);

// The board already re-reads the queue. This only looks at that snapshot again, so a session
// that landed on the last read opens the peek within a second, with no second query.
const SESSION_WAIT = Duration.seconds(1);

// What the screen asks OpenTUI to draw a screenshot with. auto is its own choice; kitty is
// forced where that choice is blocks (tmux) and the attached terminal can actually draw it.
export type ImageDraw = "kitty" | "auto";

// The screen the view draws on: OpenTUI's renderer, which takes the alternate screen and raw
// mode when opened and hands both back when the scope it was opened in closes. The signals stay
// runMain's, so SIGTERM interrupts the root fiber and the release restores the terminal; ctrl-c
// arrives as a key in raw mode and ends the view the same way q does. The mouse is left to the
// terminal, so its own selection still works.
type Opener = {
  readonly open: Effect.Effect<CliRenderer, Errors.CommandError, Scope.Scope>;
  // Read when the screen opens, after the command has accepted its flags.
  readonly imageProtocol: Effect.Effect<ImageDraw>;
  // Writes a kitty placement after a frame. The boundary owns stdout.
  readonly place: (text: string) => void;
};

export class Renderer extends Context.Service<Renderer, Opener>()("@oligarchy/viz/Renderer") {
  static readonly layer = (
    imageProtocol: Effect.Effect<ImageDraw>,
    place: (text: string) => void,
  ): Layer.Layer<Renderer> =>
    Layer.succeed(this)(
      this.of({
        imageProtocol,
        place,
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

// What POST /abort at the automation server made of the job: closed; over already (a 400 is a
// job with nothing pending or running, which on this board is one that finished since the
// last read); or refused, in the server's words or the connection's.
type Abort =
  | { readonly _tag: "aborted" }
  | { readonly _tag: "over" }
  | { readonly _tag: "refused"; readonly reason: string };

const abortJob = (
  ticket: string,
  action: Automation.AutomationAction,
): Effect.Effect<Abort, Errors.MissingVariable, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    // The url is read first, so it is the one reported first.
    const serverUrl = yield* Config.automationServerUrl;
    const token = yield* Config.oligarchyToken;
    const http = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(`${serverUrl}/abort`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(token)),
      HttpClientRequest.bodyJsonUnsafe({ ticket, action }),
    );
    const refused = (reason: string): Abort => ({ _tag: "refused", reason });
    return yield* http.execute(request).pipe(
      Effect.flatMap((response): Effect.Effect<Abort> => {
        if (response.status === 200) {
          return Effect.succeed({ _tag: "aborted" });
        }
        if (response.status === 400) {
          return Effect.succeed({ _tag: "over" });
        }
        // The status alone is the refusal; an unreadable body only loses its text.
        return response.text.pipe(
          Effect.orElseSucceed(() => ""),
          Effect.map((text) => refused(ProxyClient.apiError(text))),
        );
      }),
      Effect.catch((error) =>
        Effect.succeed(
          refused(
            `POST ${serverUrl}/abort failed: ${ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), error.message)}`,
          ),
        ),
      ),
    );
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
// at the first frame and every AGE_TICK, and every SPIN_MS while a job is running, L opens the
// selected job's ticket first, F peeks at the
// selected running job (waiting for its session if the guest has not started) and follows it
// live on a second F, a asks and then has the automation
// server abort the selected job, d opens its test definition and enter its details, and q or
// ctrl-c ends the run and the scope hands the screen back. The selected ticket's session is
// drawn in the main area, and steps aside while F holds the stream. A read that fails leaves
// the last picture up with its reason on the footer; a frame that fails ends the run. A
// session that fails leaves its calls and says so in that pane, not on the footer.
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
  | Tests.TestStore
> = Effect.gen(function* () {
  const screen = yield* Renderer;
  const imageProtocol = yield* screen.imageProtocol;
  const tickets = yield* Settings.Tickets;
  const needs = yield* Read.board(tickets);
  const prior = yield* Ref.make(Option.none<Read.Live>());
  const [view, setView] = createSignal<View.View>(View.initialView);
  const [now, setNow] = createSignal(yield* Clock.currentTimeMillis);
  // Every change to the view goes through here, so the screen redraws are steps of the fiber
  // that made them.
  const update = (change: (current: View.View) => View.View) =>
    Effect.sync(() => {
      setView(change);
    });
  const setNotice = (text: string) =>
    update((current) => ({ ...current, notice: Option.some(text) }));
  const tick = Effect.andThen(Clock.currentTimeMillis, (ms) =>
    Effect.sync(() => {
      setNow(ms);
    }),
  );
  const read = Effect.gen(function* () {
    // Taken before the queries, so an age counts from before its row was read, never after: a
    // slow read leans towards silent, not live. A once-need is kept after the open.
    const readAt = yield* Clock.currentTimeMillis;
    const snapshot = yield* Read.collect(needs, yield* Ref.get(prior), readAt);
    yield* Ref.set(prior, Option.some(snapshot));
    yield* update((current) =>
      View.land({
        ...current,
        snapshot: Option.some(snapshot),
        failure: Option.none(),
      }),
    );
    // Filled in once the session watcher exists. A read before that has nothing to attach.
    yield* yield* Ref.get(watched);
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : update((current) => ({
            ...current,
            failure: Option.some(Render.headline(Cause.squash(cause))),
          })),
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
  // the connect and the stream on the second. A piece clears itself when it ends, however it
  // ends; starting the next stops the last; and any key that leaves nothing followed interrupts
  // what is in flight, so a database or a server that never answers holds no key.
  // Effect is covariant in its requirements, so the empty effect fits a watcher that needs them.
  const watched = yield* Ref.make<
    Effect.Effect<void, never, Scope.Scope | Actions.ActionStore | HttpClient.HttpClient>
  >(Effect.void);
  const followFiber = yield* Ref.make(Option.none<Fiber.Fiber<void>>());
  const stopFollow = Effect.gen(function* () {
    const running = yield* Ref.getAndSet(followFiber, Option.none());
    if (Option.isSome(running)) {
      yield* Fiber.interrupt(running.value);
    }
  });
  const withFull = (change: (follow: Follow.Full) => Follow.Full) =>
    update((current) => {
      if (Option.isNone(current.follow) || current.follow.value._tag !== "full") {
        return current;
      }
      return { ...current, follow: Option.some(change(current.follow.value)) };
    });
  const withSession = (change: (follow: Follow.Full) => Follow.Full) =>
    update((current) => {
      if (Option.isNone(current.session) || current.session.value._tag !== "full") {
        return current;
      }
      return { ...current, session: Option.some(change(current.session.value)) };
    });
  // Ages stay on the one-second tick: an 80ms step lands short of the second, so "1 s ago"
  // would still read "0 s ago". The braille spinner needs the finer clock, and only while a
  // row is actually turning.
  const spin = Effect.gen(function* () {
    const spinning = Option.match(view().snapshot, {
      onNone: () => false,
      onSome: (snapshot) => snapshot.queue.running.length > 0,
    });
    if (spinning) {
      yield* tick;
    }
    yield* withFull(Follow.tick);
    yield* withSession(Follow.tick);
  });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const renderer = yield* screen.open;
      yield* Effect.promise(() =>
        Screen.mount(renderer, { view, now, imageProtocol, place: screen.place }),
      );
      const startFollow = <R>(work: Effect.Effect<void, never, R>) =>
        Effect.gen(function* () {
          yield* stopFollow;
          const fiber = yield* Effect.forkScoped(
            Effect.ensuring(work, Ref.set(followFiber, Option.none())),
          );
          yield* Ref.set(followFiber, Option.some(fiber));
        });
      // What a piece of follow work fails into: its reason on the footer.
      const failing = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
        Effect.catchCause(Effect.asVoid(work), (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : setNotice(Render.headline(Cause.squash(cause))),
        );
      // The first F: the job's last commands and screenshot, read from the database. A drive is
      // claimed and shown on its server before start writes the session, so a running job with a
      // ticket and no session is waited on rather than refused; the peek opens when the row appears.
      const peekWork = (job: Automation.AutomationJobListRow) =>
        failing(
          Effect.gen(function* () {
            let sessionId = job.sessionId;
            let serverUrl = job.serverUrl;
            if (sessionId === null) {
              const ticket = job.ticket;
              // followError already refused a running job that also has no ticket.
              if (ticket === null) {
                return;
              }
              type Step =
                | {
                    readonly _tag: "ready";
                    readonly sessionId: string;
                    readonly serverUrl: string | null;
                  }
                | { readonly _tag: "waiting" }
                | { readonly _tag: "gone" };
              const look = (): Step => {
                const snapshot = Option.getOrNull(view().snapshot);
                if (snapshot === null) {
                  return { _tag: "waiting" };
                }
                const found = snapshot.queue.running.find(
                  (row) => row.ticket === ticket && row.action === job.action,
                );
                if (found !== undefined && found.sessionId !== null) {
                  return {
                    _tag: "ready",
                    sessionId: found.sessionId,
                    serverUrl: found.serverUrl,
                  };
                }
                return found === undefined ? { _tag: "gone" } : { _tag: "waiting" };
              };
              let settled = look();
              if (settled._tag === "waiting") {
                yield* setNotice(`waiting for ${ticket}'s session`);
                settled = yield* Effect.repeat(Effect.sync(look), {
                  schedule: Schedule.spaced(SESSION_WAIT),
                  until: (step) => step._tag !== "waiting",
                });
              }
              if (settled._tag !== "ready") {
                if (settled._tag === "gone") {
                  yield* setNotice(`${ticket} ended before a session`);
                }
                return;
              }
              sessionId = settled.sessionId;
              serverUrl = settled.serverUrl;
            }
            const peek = yield* loadPeek(job.ticket ?? "—", sessionId, serverUrl);
            yield* update((latest) => ({
              ...latest,
              follow: Option.some(peek),
              notice: Option.none(),
            }));
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
            yield* update((current) => ({
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
      // The pop-up, up for POPUP_FOR: the clock it went up on says whose it is, so the one
      // that takes it down is its own and not a later pop-up's.
      const popup = (text: string) =>
        Effect.gen(function* () {
          const shownAt = yield* Clock.currentTimeMillis;
          yield* update((current) => ({ ...current, popup: Option.some({ text, shownAt }) }));
          yield* Effect.forkScoped(
            Effect.andThen(
              Effect.sleep(View.POPUP_FOR),
              update((current) =>
                Option.exists(current.popup, (shown) => shown.shownAt === shownAt)
                  ? { ...current, popup: Option.none() }
                  : current,
              ),
            ),
          );
        });
      // a asks first, and yes on the question sends the job to the automation server off the
      // key loop, so a server that never answers holds no key. Closed, the board is read again
      // before the footer says so, so the job is gone as the words land; over already, the
      // pop-up says what cannot be done; refused, the footer says why. One abort is in flight
      // at a time, and it is not interrupted: another A while it lasts would ask about the
      // same job again, and the answer to that, a pop-up, would be about a job this screen
      // just closed.
      const abortWork = (ticket: string, action: Automation.AutomationAction) =>
        failing(
          Effect.gen(function* () {
            const outcome = yield* abortJob(ticket, action);
            switch (outcome._tag) {
              case "aborted":
                yield* read;
                return yield* setNotice(`aborted ${action} ${ticket}`);
              case "over":
                return yield* popup(View.CANNOT_ABORT);
              case "refused":
                return yield* setNotice(outcome.reason);
            }
            return outcome satisfies never;
          }),
        );
      const aborting = yield* Ref.make(Option.none<string>());
      const ask = Effect.gen(function* () {
        const job = View.selectedJob(view());
        if (Option.isNone(job)) {
          yield* setNotice("no job selected");
          return;
        }
        const { ticket, action } = job.value;
        if (ticket === null) {
          yield* setNotice("the selected job has no ticket");
          return;
        }
        const inFlight = yield* Ref.get(aborting);
        if (Option.isSome(inFlight)) {
          yield* setNotice(`still aborting ${inFlight.value}`);
          return;
        }
        yield* update((current) => ({
          ...current,
          confirm: Option.some({ ticket, action, choice: "no" }),
        }));
      });
      const startAbort = (asked: View.Confirm) =>
        Effect.gen(function* () {
          yield* Ref.set(aborting, Option.some(`${asked.action} ${asked.ticket}`));
          yield* Effect.forkScoped(
            Effect.ensuring(
              abortWork(asked.ticket, asked.action),
              Ref.set(aborting, Option.none()),
            ),
          );
        });
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
      // The selected ticket's session, in the main area. One follower: while F holds the stream
      // this one steps aside, and a read starts it again once F has closed. A failure stays in
      // the pane; the footer is for keys.
      const sessionFiber = yield* Ref.make(Option.none<Fiber.Fiber<void>>());
      const attached = yield* Ref.make<Option.Option<string>>(Option.none());
      const stopSession = Effect.gen(function* () {
        const running = yield* Ref.getAndSet(sessionFiber, Option.none());
        if (Option.isSome(running)) {
          yield* Fiber.interrupt(running.value);
        }
      });
      const sessionKey = (current: View.View): string => {
        const job = Option.getOrNull(View.selectedJob(current));
        return job === null
          ? ""
          : `${job.ticket ?? ""}|${job.action}|${job.status}|${job.sessionId ?? ""}|${job.serverUrl ?? ""}`;
      };
      const note = (text: string) =>
        update((current) => ({
          ...current,
          session: Option.none(),
          sessionNote: Option.some(text),
        }));
      const sessionWork = (job: Automation.AutomationJobListRow) =>
        Effect.gen(function* () {
          type Step =
            | {
                readonly _tag: "ready";
                readonly sessionId: string;
                readonly serverUrl: string | null;
              }
            | { readonly _tag: "waiting" }
            | { readonly _tag: "gone" }
            | { readonly _tag: "none" };
          const initial = (): Step => {
            if (job.sessionId !== null) {
              return { _tag: "ready", sessionId: job.sessionId, serverUrl: job.serverUrl };
            }
            if (job.status === "running" && job.ticket !== null) {
              return { _tag: "waiting" };
            }
            return { _tag: "none" };
          };
          let settled = initial();
          if (settled._tag === "none") {
            yield* note("no session");
            return;
          }
          if (settled._tag === "waiting") {
            const ticket = job.ticket;
            if (ticket === null) {
              yield* note("no session");
              return;
            }
            yield* note(`waiting for ${ticket}'s session`);
            const look = (): Step => {
              const snapshot = Option.getOrNull(view().snapshot);
              const found = snapshot?.queue.running.find(
                (row) => row.ticket === ticket && row.action === job.action,
              );
              if (found !== undefined && found.sessionId !== null) {
                return {
                  _tag: "ready",
                  sessionId: found.sessionId,
                  serverUrl: found.serverUrl,
                };
              }
              return found === undefined ? { _tag: "gone" } : { _tag: "waiting" };
            };
            settled = yield* Effect.repeat(Effect.sync(look), {
              schedule: Schedule.spaced(SESSION_WAIT),
              until: (step) => step._tag !== "waiting",
            });
          }
          if (settled._tag !== "ready") {
            yield* note("no session");
            return;
          }
          const { sessionId, serverUrl } = settled;
          const peek = yield* loadPeek(job.ticket ?? "—", sessionId, serverUrl);
          yield* update((latest) => ({
            ...latest,
            session: Option.some(peek),
            sessionNote: Option.none(),
          }));
          if (serverUrl === null || job.status !== "running") {
            return;
          }
          const liveUrl = serverUrl;
          const token = yield* Config.oligarchyToken;
          const proxy = yield* ProxyClient.connect({ serverUrl: liveUrl, token });
          const bytes = yield* proxy.follow(sessionId);
          yield* update((current) => ({
            ...current,
            session: Option.some(Follow.expand(peek, liveUrl)),
            sessionNote: Option.none(),
          }));
          yield* Stream.splitLines(Stream.decodeText(bytes)).pipe(
            Stream.filter((line) => line !== ""),
            Stream.runForEach((line) =>
              Effect.andThen(Domain.decodeFollowLine(line).pipe(Effect.orDie), (event) =>
                withSession((follow) => Follow.apply(follow, event)),
              ),
            ),
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : update((current) => ({
                  ...current,
                  sessionNote: Option.some(Render.headline(Cause.squash(cause))),
                })),
          ),
        );
      const syncSession = Effect.gen(function* () {
        if (Option.isSome(view().follow) || Option.isSome(yield* Ref.get(followFiber))) {
          yield* stopSession;
          yield* Ref.set(attached, Option.none());
          return;
        }
        const key = sessionKey(view());
        const known = yield* Ref.get(attached);
        const running = yield* Ref.get(sessionFiber);
        if (Option.isSome(known) && known.value === key && (Option.isSome(running) || key === "")) {
          return;
        }
        yield* Ref.set(attached, Option.some(key));
        yield* stopSession;
        const job = Option.getOrNull(View.selectedJob(view()));
        if (job === null) {
          yield* note("no session");
          return;
        }
        const fiber = yield* Effect.forkScoped(
          Effect.ensuring(sessionWork(job), Ref.set(sessionFiber, Option.none())),
        );
        yield* Ref.set(sessionFiber, Option.some(fiber));
      });
      yield* Ref.set(watched, syncSession);
      const openDefinition = Effect.gen(function* () {
        const job = Option.getOrNull(View.selectedJob(view()));
        if (job === null) {
          yield* setNotice("no job selected");
          return;
        }
        const tests = yield* Tests.TestStore;
        const found = yield* Effect.result(tests.findTestDefinition(job.test));
        if (Result.isFailure(found)) {
          yield* setNotice(Render.headline(found.failure));
          return;
        }
        const definition = Option.getOrNull(found.success);
        if (definition === null) {
          yield* setNotice(`no test definition named ${job.test}`);
          return;
        }
        yield* update((current) => ({
          ...current,
          sheet: Option.some(View.definitionSheet(definition)),
          notice: Option.none(),
        }));
      });
      const openInfo = Effect.gen(function* () {
        const current = view();
        const job = Option.getOrNull(View.selectedJob(current));
        if (job === null) {
          yield* setNotice("no job selected");
          return;
        }
        const drift = Option.match(current.snapshot, {
          onNone: () => 0,
          onSome: (snapshot) => now() - snapshot.readAt,
        });
        yield* update((latest) => ({
          ...latest,
          sheet: Option.some(View.infoSheet(job, drift)),
          notice: Option.none(),
        }));
      });
      const keys = keysOf(renderer).pipe(
        Stream.takeWhile((key) => !View.isQuit(key)),
        Stream.runForEach((key) =>
          Effect.gen(function* () {
            const asked = view().confirm;
            yield* update((current) => View.press(current, key));
            // The question had the key: yes on enter is the one answer that does anything.
            if (Option.isSome(asked)) {
              if (View.isSelect(key) && asked.value.choice === "yes") {
                yield* startAbort(asked.value);
              }
              return;
            }
            if (Option.isNone(view().follow)) {
              yield* stopFollow;
            }
            if (View.isOpen(key)) {
              yield* open;
            }
            if (View.isFollow(key)) {
              yield* openFollow;
            }
            if (View.isAbort(key)) {
              yield* ask;
            }
            if (View.isDefinition(key)) {
              yield* openDefinition;
            }
            if (View.isSelect(key)) {
              yield* openInfo;
            }
            yield* syncSession;
          }),
        ),
      );
      yield* Effect.raceAllFirst([
        keys,
        Effect.repeat(read, Schedule.spaced(View.REFRESH)),
        Effect.repeat(tick, Schedule.spaced(View.AGE_TICK)),
        // The glyph is floor(now / SPIN_MS), so this clock has to land on the interval. spaced
        // waits SPIN_MS after the redraw and the index skips a frame.
        Effect.repeat(spin, Schedule.fixed(Duration.millis(View.SPIN_MS))),
        drawFailure(renderer),
      ]);
    }),
  );
});
