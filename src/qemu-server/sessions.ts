import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  MutableRef,
  Option,
  Queue,
  Ref,
  Result,
  Schedule,
  Schema,
  Scope,
  Semaphore,
  Stream,
  Tracer,
} from "effect";
import * as Actions from "../db/actions.ts";
import * as DebugLogs from "../db/debug-logs.ts";
import * as SessionStore from "../db/sessions.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Iso from "../qemu/iso.ts";
import * as Keys from "../qemu/keys.ts";
import * as Minted from "../qemu/minted.ts";
import * as Qemu from "../qemu/qemu.ts";
import * as Stats from "../qemu/stats.ts";
import type * as Qmp from "../qmp/client.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_CHECK = "10 seconds";
const SESSION_TIMEOUT_REASON = "no command received for 10 minutes";
// A reservation is a promise that a start follows soon. One nobody starts (the client that took
// it died, or the dispatcher behind it did) would hold a --max-jobs slot until this process
// restarted; ten minutes unused and it is given back, as a session with no command is. The
// sweep that times sessions out notices. In memory only: no row records a reservation.
const RESERVATION_TIMEOUT_MS = 10 * 60 * 1000;
const RESERVATION_TIMEOUT_REASON = "unused for 10 minutes";
const RELINQUISH_REASON = "relinquished";
const SHUTDOWN_REASON = "qemu server shutdown";
const RESTART_REASON = "qemu server restarted";
// An installed Omarchy shuts down in seconds; a guest still up two minutes after the power button
// is not going to, and its disk is not one to keep.
const SAVE_POWEROFF = "2 minutes";
const SAVE_POWEROFF_REASON = "guest did not power off within 2 minutes";
// A wheel tick is two QMP exchanges and two action rows; cap the count so one request cannot
// enqueue an unbounded amount of work.
const MAX_TICKS = 100;
// Each chord is a QMP exchange and an action row, paced ~60ms apart; cap the count so one request
// cannot run for many minutes or write thousands of rows.
const MAX_KEYS = 1000;
// A follower this many events behind has stopped reading; it is dropped rather than letting its
// queue hold every image the session takes from then on.
const FOLLOW_BACKLOG = 64;

type Follower = Queue.Queue<Domain.FollowEvent, Cause.Done>;

type Intent = { readonly span: Tracer.Span; readonly message: string };

type Image = { readonly id: string; readonly png: string };

export type LiveSession = {
  readonly id: string;
  readonly agent: string;
  // The iso as the start named it: a save keeps the disk beside it. A resumed session's disk is
  // an overlay on the minted one and is never kept.
  readonly iso: string;
  readonly mode: Domain.SessionMode;
  readonly qemu: Qemu.QemuHandle;
  readonly span: Tracer.Span;
  readonly scope: Scope.Closeable;
  readonly lastCommandAt: Ref.Ref<number>;
  readonly intent: Ref.Ref<Option.Option<Intent>>;
  readonly image: Ref.Ref<Option.Option<Image>>;
  readonly followers: Ref.Ref<ReadonlySet<Follower>>;
  readonly actionSeq: Ref.Ref<number>;
  readonly actionSpans: Ref.Ref<ReadonlySet<Tracer.Span>>;
};

// Everything a session has before QEMU answers; followers and the recorder need no more.
type OpenSession = Omit<LiveSession, "qemu">;

export type SessionsService = {
  // Takes a --max-jobs slot for this agent, before anything is minted or written. A second
  // reserve for the same agent is BadRequest: one id, one unused reservation. Start consumes
  // it and does not increment again. A resume names the iso whose minted disk the slot must
  // boot; when this machine has the room but not that disk the answer is SetupNeeded and the
  // slot is not taken.
  readonly reserve: (
    agent: string,
    resume?: string,
    pinned?: string,
  ) => Effect.Effect<void, Errors.AtCapacity | Errors.BadRequest | Errors.SetupNeeded>;
  // Gives back everything the agent holds: an unused reservation, and its running session,
  // which is stopped as aborted. Fails BadRequest when it holds nothing, a start in flight
  // included.
  readonly relinquish: (agent: string) => Effect.Effect<void, Errors.BadRequest | Errors.Internal>;
  // Consumes this agent's reservation. Fails BadRequest, before anything is minted or written,
  // when there is none. A start that fails hands the reservation back, so the same agent may
  // retry without reserving again.
  readonly start: (
    body: Contract.StartBody,
    display: Domain.QemuDisplay,
    automation: boolean,
  ) => Effect.Effect<string, Errors.BadRequest | Errors.StartFailed | Errors.Internal>;
  // Resets lastCommandAt before returning: a valid request counts as activity.
  readonly lookup: (
    id: string,
    agent: string,
  ) => Effect.Effect<LiveSession, Errors.BadRequest | Errors.UnknownSession | Errors.Forbidden>;
  readonly image: (
    live: LiveSession,
  ) => Effect.Effect<
    { readonly png: Uint8Array; readonly imageId: string },
    Errors.ExchangeFailed | Errors.Internal
  >;
  readonly serial: (live: LiveSession) => Effect.Effect<Uint8Array, Errors.Internal>;
  readonly sendKeys: (
    live: LiveSession,
    keys: string,
    encoding: string | undefined,
  ) => Effect.Effect<void, Errors.BadRequest | Errors.ExchangeFailed>;
  // One mouse operation; a point off the screenshot or a tick count out of range is BadRequest
  // before any exchange.
  readonly mouse: (
    live: LiveSession,
    gesture: Qemu.MouseGesture,
  ) => Effect.Effect<void, Errors.BadRequest | Errors.ExchangeFailed>;
  readonly intentStart: (
    live: LiveSession,
    testResultId: string,
    message: string,
  ) => Effect.Effect<void, Errors.BadRequest>;
  readonly intentEnd: (live: LiveSession) => Effect.Effect<void, Errors.BadRequest>;
  // Fails unknownSession when the sweep took the session first: one session, one verdict.
  readonly stop: (
    live: LiveSession,
    status: Domain.StopStatus | undefined,
    reason: string | undefined,
  ) => Effect.Effect<void, Errors.Internal | Errors.UnknownSession>;
  // Ends the session keeping its disk as the machine's minted disk for its iso: the guest is
  // powered down, its disk and firmware copy are kept, the row closes succeeded. A guest that
  // will not power off, or a disk that cannot be kept, ends the session errored instead. A
  // resumed session is refused BadRequest and runs on: its disk is an overlay whose base another
  // save may replace, so flattening it could keep the wrong machine.
  readonly save: (
    live: LiveSession,
  ) => Effect.Effect<
    void,
    Errors.BadRequest | Errors.SaveFailed | Errors.Internal | Errors.UnknownSession
  >;
  readonly follow: (
    id: string,
  ) => Effect.Effect<
    Stream.Stream<Domain.FollowEvent>,
    Errors.UnknownSession | Errors.Conflict | Errors.Internal
  >;
  readonly stats: Effect.Effect<Contract.Stats>;
  // Whether this machine holds the iso's minted disk, by the name a start would give.
  readonly minted: (iso: string) => Effect.Effect<boolean>;
  // How many jobs this process currently holds against --max-jobs: reserved plus running.
  readonly jobs: Effect.Effect<number>;
};

// What the drain finalizer reads and reports: the reason every surviving session's row is closed
// with (main's server error path replaces the default) and whether a session refused to close.
// MutableRefs, because main writes from a Node listener and the teardown reads outside Effect.
export type Shutdown = {
  readonly reason: MutableRef.MutableRef<string>;
  readonly failed: MutableRef.MutableRef<boolean>;
};

export const Shutdown = Context.Reference<Shutdown>("@oligarchy/qemu-server/sessions/Shutdown", {
  defaultValue: () => ({
    reason: MutableRef.make(SHUTDOWN_REASON),
    failed: MutableRef.make(false),
  }),
});

const isDatabaseError = Schema.is(Errors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

const withItem = <T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => new Set([...set, item]);

const without = <T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => {
  const next = new Set(set);
  next.delete(item);
  return next;
};

const mapWith = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map([...map, [key, value]]);

const mapWithout = <V>(
  map: ReadonlyMap<string, V>,
  keys: Iterable<string>,
): ReadonlyMap<string, V> => {
  const next = new Map(map);
  for (const key of keys) {
    next.delete(key);
  }
  return next;
};

const attribution = (location: string, agentId: string | undefined): Log.Attribution =>
  agentId === undefined ? { location } : { location, agentId };

const internal = (cause: unknown, sessionId: string, agentId?: string): Errors.Internal =>
  agentId === undefined
    ? Errors.Internal.make({ cause, sessionId })
    : Errors.Internal.make({ cause, sessionId, agentId });

const exchangeFailed = (error: unknown, live: OpenSession): Errors.ExchangeFailed =>
  Errors.ExchangeFailed.make({
    message: detail(error),
    cause: error,
    sessionId: live.id,
    agentId: live.agent,
  });

const badRequest = (message: string, live: OpenSession): Errors.BadRequest =>
  Errors.BadRequest.make({ message, sessionId: live.id, agentId: live.agent });

// The gesture as the log line reads it: its point or points, its button, the keys held.
const describeGesture = (gesture: Qemu.MouseGesture): string => {
  const held = (modifiers: ReadonlyArray<Domain.MouseModifier> | undefined) =>
    modifiers === undefined ? "" : modifiers.map((key) => ` +${key}`).join("");
  switch (gesture._tag) {
    case "move":
      return `${String(gesture.x)} ${String(gesture.y)}`;
    case "click":
    case "double-click":
      return `${String(gesture.x)} ${String(gesture.y)} ${gesture.button}${held(gesture.modifiers)}`;
    case "scroll":
      return `${String(gesture.x)} ${String(gesture.y)} ${gesture.direction} ×${String(gesture.ticks)}`;
    case "drag":
      return `${String(gesture.from.x)} ${String(gesture.from.y)} to ${String(gesture.to.x)} ${String(gesture.to.y)} ${gesture.button}${held(gesture.modifiers)}`;
    case "hold":
    case "release":
      return `${String(gesture.x)} ${String(gesture.y)} ${gesture.button}`;
  }
  return gesture satisfies never;
};

const make = (maxJobs: number, selfUrl?: string) =>
  Effect.gen(function* () {
    const qemu = yield* Qemu.Qemu;
    const iso = yield* Iso.Iso;
    const minted = yield* Minted.Minted;
    const stats = yield* Stats.Stats;
    const sessionStore = yield* SessionStore.SessionStore;
    const actionStore = yield* Actions.ActionStore;
    const debugLogs = yield* DebugLogs.DebugLogStore;
    const log = yield* Log.Log;
    const fs = yield* FileSystem.FileSystem;
    const shutdown = yield* Shutdown;

    // Running machines, by id; and every session this qemu server holds, booting ones included.
    const sessions = yield* Ref.make<ReadonlyMap<string, LiveSession>>(new Map());
    const openSessions = yield* Ref.make<ReadonlyMap<string, OpenSession>>(new Map());
    // How many sessions are admitted against --max-jobs, and which agents already hold a slot
    // that start will consume, each with when it was taken. Taken at reserve, before the span,
    // scope or row exist, so a refusal allocates nothing; given back in finishLiveSession, the
    // one place every admitted session ends, or by the sweep when no start ever came. A start
    // that fails puts the reservation back as it was (failStart).
    const slots = yield* Ref.make<{
      readonly count: number;
      readonly reserved: ReadonlyMap<string, number>;
    }>({ count: 0, reserved: new Map() });

    const elapsed = (started: number) =>
      Effect.map(Clock.currentTimeMillis, (now) => String(now - started));

    // -------------------------------------------------------------------------
    // followers
    // -------------------------------------------------------------------------

    const emit = (live: OpenSession, event: Domain.FollowEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        for (const follower of yield* Ref.get(live.followers)) {
          if (Queue.offerUnsafe(follower, event)) {
            continue;
          }
          yield* Ref.update(live.followers, (set) => without(set, follower));
          Queue.endUnsafe(follower);
          yield* log.warning(`follower dropped; ${String(FOLLOW_BACKLOG)} events behind`, {
            location: live.id,
            agentId: live.agent,
          });
        }
      });

    // Brackets one request's work for the followers: a running line when it starts, then its verdict.
    const followed = <A, E>(
      live: OpenSession,
      name: Domain.ActionName,
      work: Effect.Effect<A, E>,
    ): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const id = yield* Ref.updateAndGet(live.actionSeq, (n) => n + 1);
        yield* emit(live, { type: "action", id, name, state: "running" });
        return yield* Effect.onExit(work, (exit) =>
          emit(live, { type: "action", id, state: Exit.isSuccess(exit) ? "completed" : "failed" }),
        );
      });

    const detach = (live: OpenSession, follower: Follower): Effect.Effect<void> =>
      Effect.gen(function* () {
        const removed = yield* Ref.modify(live.followers, (set) =>
          set.has(follower) ? [true, without(set, follower)] : [false, set],
        );
        if (removed) {
          yield* log.info("follower detached", { location: live.id, agentId: live.agent });
        }
      });

    // -------------------------------------------------------------------------
    // action spans and the recorder
    // -------------------------------------------------------------------------

    // Open from the recorder's open to its close, under the open intent or the session.
    const openActionSpan = (
      live: OpenSession,
      command: Domain.QmpCommand,
    ): Effect.Effect<Tracer.Span> =>
      Effect.gen(function* () {
        const parent = Option.match(yield* Ref.get(live.intent), {
          onNone: () => live.span,
          onSome: (intent) => intent.span,
        });
        const span = yield* Sentry.actionSpan(parent, command.execute, live.id, live.agent);
        yield* Ref.update(live.actionSpans, (spans) => withItem(spans, span));
        return span;
      });

    // Ends the span once: a session ending with actions in flight fails what is still open.
    const settleActionSpan = (
      live: OpenSession,
      span: Tracer.Span,
      state: Domain.ActionState,
      imageUrl?: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const open = yield* Ref.modify(live.actionSpans, (spans) =>
          spans.has(span) ? [true, without(spans, span)] : [false, spans],
        );
        if (open) {
          yield* Sentry.endActionSpan(span, state, imageUrl);
        }
      });

    // Opens the span and the action row; a refused insert fails the exchange up front.
    const beginAction = (live: OpenSession, command: Domain.QmpCommand) =>
      Effect.gen(function* () {
        const span = yield* openActionSpan(live, command);
        const id = yield* actionStore
          .startAction({ sessionId: live.id, agentId: live.agent, request: command })
          .pipe(Effect.tapError(() => settleActionSpan(live, span, "failed")));
        return { span, id };
      });

    const recorder =
      (live: OpenSession): Qmp.Recorder =>
      (command) =>
        Effect.map(
          beginAction(live, command),
          ({ span, id }) =>
            (outcome) =>
              Effect.gen(function* () {
                yield* settleActionSpan(live, span, outcome.state);
                yield* actionStore.finishAction(id, outcome).pipe(
                  Effect.tapError((error) =>
                    log.error(`db: closing action ${String(id)} failed: ${detail(error)}`, {
                      location: live.id,
                      agentId: live.agent,
                      cause: error,
                    }),
                  ),
                );
              }),
        );

    // -------------------------------------------------------------------------
    // ending a session
    // -------------------------------------------------------------------------

    const finishOpenIntent = (
      live: OpenSession,
      state: "completed" | "cancelled",
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const intent = yield* Ref.getAndSet(live.intent, Option.none());
        if (Option.isNone(intent)) {
          return;
        }
        yield* Sentry.endIntentSpan(intent.value.span, state);
        yield* emit(live, { type: "intent", state });
      });

    const finishLiveSession = (
      live: OpenSession,
      status: Domain.SessionEndStatus,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(openSessions, (map) => mapWithout(map, [live.id]));
        yield* Ref.update(slots, (held) => ({ ...held, count: held.count - 1 }));
        yield* log.releaseColor(live.agent);
        for (const span of yield* Ref.get(live.actionSpans)) {
          yield* settleActionSpan(live, span, "failed");
        }
        yield* finishOpenIntent(live, "cancelled");
        yield* Sentry.endSessionSpan(live.span, status);
        yield* emit(live, { type: "session", status });
        for (const follower of yield* Ref.getAndSet(live.followers, new Set())) {
          Queue.endUnsafe(follower);
        }
      });

    // Leaving the session scope kills QEMU and removes its directory.
    const kill = (live: OpenSession): Effect.Effect<void> => Scope.close(live.scope, Exit.void);

    const killLogged = (live: OpenSession, prefix: string, agentId: string | undefined) =>
      kill(live).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.interrupt;
          }
          const error = Cause.squash(cause);
          return log.error(`${prefix}: ${detail(error)}`, {
            ...attribution(live.id, agentId),
            cause: error,
          });
        }),
      );

    // -------------------------------------------------------------------------
    // start
    // -------------------------------------------------------------------------

    const launch = (
      live: OpenSession,
      body: Contract.StartBody,
      source: Qemu.DiskSource,
      display: Domain.QemuDisplay,
      automation: boolean,
    ): Effect.Effect<
      Qemu.QemuHandle,
      Errors.QemuStartError | Errors.IsoError | Errors.DatabaseError
    > =>
      Effect.gen(function* () {
        // Checked before anything else: a wrong disk path must not cost an iso download, and it
        // must fail ahead of registerAgent, or the agent's one registration is spent on a machine
        // that never booted.
        if (source._tag === "existing") {
          yield* fs
            .stat(source.path)
            .pipe(
              Effect.mapError(() =>
                Errors.QemuStartError.make({ message: `qemu: disk not found: ${source.path}` }),
              ),
            );
        }
        // A minted disk boots itself: no iso to fetch, none to attach.
        const cdrom =
          source._tag === "minted"
            ? undefined
            : yield* iso.getIso(body.iso, { sessionId: live.id, agentId: live.agent });
        const prepared = yield* qemu.prepare(live.id, source).pipe(Scope.provide(live.scope));
        // Register right before boot: the handshake records an action that references agent_runs,
        // so this must precede start(), but a failed download or disk create before here must not
        // burn the agent id on its one-registration key.
        yield* sessionStore.registerAgent(live.agent, live.id);
        const handle = yield* qemu
          .start(prepared, { cdrom, display, automation, record: recorder(live) })
          .pipe(Scope.provide(live.scope));
        yield* sessionStore.sessionRunning(live.id);
        return handle;
      }).pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            // Best effort: the row and the caller's error are what matter once boot has failed.
            yield* Effect.ignore(kill(live));
            yield* sessionStore.endSession(live.id, "errored", detail(error)).pipe(
              Effect.catch((failure) =>
                log.error(`db: recording a failed start failed too: ${failure.message}`, {
                  location: live.id,
                  agentId: live.agent,
                  cause: failure,
                }),
              ),
            );
          }),
        ),
      );

    const admit = (
      outcome: "ok" | "held" | "full",
      agent: string,
    ): Effect.Effect<void, Errors.AtCapacity | Errors.BadRequest> => {
      if (outcome === "ok") {
        return Effect.void;
      }
      if (outcome === "held") {
        return Errors.BadRequest.make({
          message: "already reserved",
          agentId: agent,
        });
      }
      return Errors.AtCapacity.make({
        message: `at capacity: max-jobs is ${String(maxJobs)}`,
        agentId: agent,
      });
    };

    const reserve = Effect.fn("Sessions.reserve")(function* (
      agent: string,
      resume?: string,
      pinned?: string,
    ) {
      // A pin names one server. This machine takes the slot only when that name is its own.
      if (pinned !== undefined && pinned !== selfUrl) {
        return yield* Errors.BadRequest.make({
          message:
            selfUrl === undefined
              ? `reserve is for ${pinned}`
              : `reserve is for ${pinned}, not ${selfUrl}`,
          agentId: agent,
        });
      }
      // Held and full are answered before a disk lookup: a second reserve is still "already
      // reserved", and a full machine cannot gain a resume slot by being set up.
      const snapshot = yield* Ref.get(slots);
      if (snapshot.reserved.has(agent)) {
        return yield* admit("held", agent);
      }
      if (snapshot.count >= maxJobs) {
        return yield* admit("full", agent);
      }
      if (resume !== undefined && Option.isNone(yield* minted.find(resume))) {
        return yield* Errors.SetupNeeded.make({
          message: `setup needed: max-jobs is ${String(maxJobs)}`,
          agentId: agent,
        });
      }
      const now = yield* Clock.currentTimeMillis;
      return yield* Effect.flatMap(
        Ref.modify(slots, (held) => {
          if (held.reserved.has(agent)) {
            return ["held", held] as const;
          }
          if (held.count >= maxJobs) {
            return ["full", held] as const;
          }
          return [
            "ok",
            { count: held.count + 1, reserved: mapWith(held.reserved, agent, now) },
          ] as const;
        }),
        (outcome) => admit(outcome, agent),
      );
    });

    // A start that fails hands the reservation back as it was, deadline included: the slot was
    // this agent's before the start and stays so, so the retry is admitted rather than refused
    // as "no reservation" (OLI-1309: one refused database connection cost a driver its counted
    // slot). Taken back before finishLiveSession gives the session's slot up, so the count never
    // dips below what is held and a racing reserve is refused rather than admitted twice. A
    // reserve for this agent that landed while the start was in flight already holds a slot of
    // its own; that one stands, and the failed session's slot is simply given up.
    const failStart = <E>(live: OpenSession, since: number, error: E): Effect.Effect<never, E> =>
      Ref.update(slots, (held) =>
        held.reserved.has(live.agent)
          ? held
          : { count: held.count + 1, reserved: mapWith(held.reserved, live.agent, since) },
      ).pipe(
        Effect.andThen(finishLiveSession(live, "errored")),
        Effect.andThen(Effect.fail(error)),
      );

    const start = Effect.fn("Sessions.start")(function* (
      body: Contract.StartBody,
      display: Domain.QemuDisplay,
      automation: boolean,
    ) {
      const agent = body.agent;
      const noReservation = Errors.BadRequest.make({ message: "no reservation", agentId: agent });
      // Refused before the reservation is consumed, so a caller told no can relinquish it, or
      // start fresh instead.
      if (!(yield* Ref.get(slots)).reserved.has(agent)) {
        return yield* noReservation;
      }
      const disk = body.disk;
      const mode = body.mode ?? "fresh";
      const source: Qemu.DiskSource = yield* Effect.gen(function* () {
        if (mode === "fresh") {
          return disk === undefined
            ? { _tag: "fresh" as const }
            : { _tag: "existing" as const, path: disk };
        }
        if (disk !== undefined) {
          return yield* Errors.BadRequest.make({
            message: "a resume boots the minted disk; --disk cannot be given",
            agentId: agent,
          });
        }
        const found = yield* minted.find(body.iso);
        // A resume is only reserved where this disk already is, so a start that finds none is
        // this process breaking its own contract. 500, reported: the reservation stands.
        if (Option.isNone(found)) {
          return yield* Errors.Internal.make({
            cause: new Error(`no minted disk for ${body.iso} on this machine`),
            agentId: agent,
          });
        }
        return { _tag: "minted" as const, ...found.value };
      });
      // Consumed with its deadline, so a failed start can hand it back as it was. The sweep can
      // take it between the look above and here.
      const reservation = yield* Ref.modify(slots, (held) => {
        const since = Option.fromUndefinedOr(held.reserved.get(agent));
        return [
          since,
          Option.isNone(since)
            ? held
            : { count: held.count, reserved: mapWithout(held.reserved, [agent]) },
        ] as const;
      });
      if (Option.isNone(reservation)) {
        return yield* noReservation;
      }
      const since = reservation.value;
      const started = yield* Clock.currentTimeMillis;
      const id: string = crypto.randomUUID();
      const live: OpenSession = {
        id,
        agent,
        iso: body.iso,
        mode,
        span: yield* Sentry.sessionSpan(id, agent),
        scope: yield* Scope.make(),
        lastCommandAt: yield* Ref.make(started),
        intent: yield* Ref.make(Option.none<Intent>()),
        image: yield* Ref.make(Option.none<Image>()),
        followers: yield* Ref.make<ReadonlySet<Follower>>(new Set()),
        actionSeq: yield* Ref.make(0),
        actionSpans: yield* Ref.make<ReadonlySet<Tracer.Span>>(new Set()),
      };
      yield* Ref.update(openSessions, (map) => mapWith(map, id, live));
      yield* log.acquireColor(agent);
      // A minted disk boots itself: nothing to download, so the row is running from the start.
      yield* sessionStore
        .insertSession(
          id,
          Object.assign(
            { iso: body.iso },
            disk === undefined ? undefined : { disk },
            mode === "resume" ? { mode } : undefined,
          ),
          Domain.isIsoUrl(body.iso) && mode === "fresh" ? "downloading" : "running",
        )
        .pipe(Effect.catch((cause) => failStart(live, since, internal(cause, id, agent))));
      yield* log.info(
        `starting; iso ${body.iso}${disk === undefined ? "" : `, disk ${disk}`}${mode === "resume" ? "; resume" : ""}`,
        { location: id, agentId: agent },
      );
      const handle = yield* launch(live, body, source, display, automation).pipe(
        Effect.catch((error) =>
          failStart(
            live,
            since,
            Errors.StartFailed.make({
              message: detail(error),
              cause: error,
              sessionId: id,
              agentId: agent,
            }),
          ),
        ),
      );
      const running: LiveSession = { ...live, qemu: handle };
      yield* Ref.set(running.lastCommandAt, yield* Clock.currentTimeMillis);
      yield* Ref.update(sessions, (map) => mapWith(map, id, running));
      yield* emit(running, { type: "session", status: "running" });
      yield* log.info(`running; started in ${yield* elapsed(started)}ms`, {
        location: id,
        agentId: agent,
      });
      return id;
    });

    // -------------------------------------------------------------------------
    // driving a running session
    // -------------------------------------------------------------------------

    const lookup = Effect.fn("Sessions.lookup")(function* (id: string, agent: string) {
      if (id === "") {
        return yield* Errors.BadRequest.make({ message: "session id is required", agentId: agent });
      }
      const live = (yield* Ref.get(sessions)).get(id);
      if (live === undefined) {
        return yield* Errors.unknownSession(id, agent);
      }
      if (live.agent !== agent) {
        return yield* Errors.Forbidden.make({
          message: `agent "${agent}" does not own session "${id}"`,
          sessionId: id,
          agentId: agent,
        });
      }
      // A valid request counts as activity even when the exchange it starts later fails.
      yield* Ref.set(live.lastCommandAt, yield* Clock.currentTimeMillis);
      return live;
    });

    const image = Effect.fn("Sessions.image")(function* (live: LiveSession) {
      const started = yield* Clock.currentTimeMillis;
      const imageId: string = crypto.randomUUID();
      const url = Contract.StoredImageUrl(imageId);
      // The images row must ride the same transaction that closes the action (they are 1:1), so
      // this recorder only stashes and the method closes.
      const opened = yield* Ref.make(Option.none<number>());
      const outcome = yield* Ref.make(Option.none<Domain.QmpExchangeOutcome>());
      const record: Qmp.Recorder = (command) =>
        Effect.gen(function* () {
          const { span, id } = yield* beginAction(live, command);
          yield* Ref.set(opened, Option.some(id));
          return (result) =>
            Effect.gen(function* () {
              yield* Ref.set(outcome, Option.some(result));
              yield* settleActionSpan(
                live,
                span,
                result.state,
                result.state === "completed" ? url : undefined,
              );
            });
        });
      // Only a failed exchange is closed without an image; a completed one whose image write failed
      // stays open rather than break the 1:1 promise.
      const closeFailedExchange = Effect.gen(function* () {
        const id = yield* Ref.get(opened);
        const result = yield* Ref.get(outcome);
        if (Option.isNone(id) || Option.isNone(result) || result.value.state !== "failed") {
          return;
        }
        yield* actionStore.finishAction(id.value, result.value).pipe(
          Effect.catch((failure) =>
            log.error(`db: recording a failed screendump failed too: ${failure.message}`, {
              location: live.id,
              agentId: live.agent,
              cause: failure,
            }),
          ),
        );
      });
      const work = Effect.gen(function* () {
        const png = yield* live.qemu.screendump(record).pipe(
          Effect.mapError((error) =>
            error._tag === "PlatformError"
              ? internal(error, live.id, live.agent)
              : exchangeFailed(error, live),
          ),
          Effect.tapError(() => closeFailedExchange),
        );
        const id = yield* Ref.get(opened);
        const result = yield* Ref.get(outcome);
        if (Option.isNone(id) || Option.isNone(result)) {
          return yield* Effect.die("screendump completed without recording its exchange");
        }
        yield* actionStore
          .finishAction(id.value, result.value, { id: imageId, data: png })
          .pipe(Effect.mapError((cause) => internal(cause, live.id, live.agent)));
        const stored: Image = { id: imageId, png: Buffer.from(png).toString("base64") };
        yield* Ref.set(live.image, Option.some(stored));
        yield* emit(live, { type: "image", id: stored.id, png: stored.png });
        yield* log.info(
          `image; ${String(png.length)} bytes in ${yield* elapsed(started)}ms; ${url}`,
          { location: live.id, agentId: live.agent },
        );
        return { png, imageId };
      });
      return yield* followed(live, "get-image", work).pipe(Effect.tapError(() => endIfGone(live)));
    });

    const serial = Effect.fn("Sessions.serial")(function* (live: LiveSession) {
      const started = yield* Clock.currentTimeMillis;
      const data = yield* followed(
        live,
        "get-serial",
        fs
          .readFile(live.qemu.serialPath)
          .pipe(Effect.mapError((cause) => internal(cause, live.id, live.agent))),
      );
      yield* log.info(`serial; ${String(data.length)} bytes in ${yield* elapsed(started)}ms`, {
        location: live.id,
        agentId: live.agent,
      });
      return data;
    });

    const sendKeys = Effect.fn("Sessions.sendKeys")(function* (
      live: LiveSession,
      keys: string,
      encoding: string | undefined,
    ) {
      const started = yield* Clock.currentTimeMillis;
      const parsed = Keys.parseKeys(keys, encoding ?? "oligarchy");
      if (Result.isFailure(parsed)) {
        return yield* badRequest(parsed.failure.message, live);
      }
      const chords = parsed.success;
      if (chords.length > MAX_KEYS) {
        return yield* badRequest(`send-keys: at most ${String(MAX_KEYS)} keys per request`, live);
      }
      yield* followed(
        live,
        "send-keys",
        live.qemu
          .sendKeys(chords, recorder(live))
          .pipe(Effect.mapError((error) => exchangeFailed(error, live))),
      ).pipe(Effect.tapError(() => endIfGone(live)));
      return yield* log.info(
        `sent ${String(chords.length)} chords in ${yield* elapsed(started)}ms`,
        {
          location: live.id,
          agentId: live.agent,
        },
      );
    });

    const mouse = Effect.fn("Sessions.mouse")(function* (
      live: LiveSession,
      gesture: Qemu.MouseGesture,
    ) {
      const started = yield* Clock.currentTimeMillis;
      const onScreen = (point: Domain.ScreenPoint) =>
        point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
      if (gesture._tag === "drag") {
        if (!onScreen(gesture.from) || !onScreen(gesture.to)) {
          return yield* badRequest("mouse: from and to must be in 0..1", live);
        }
      } else if (!onScreen(gesture)) {
        return yield* badRequest("mouse: x and y must be in 0..1", live);
      }
      if (
        gesture._tag === "scroll" &&
        (!Number.isInteger(gesture.ticks) || gesture.ticks < 1 || gesture.ticks > MAX_TICKS)
      ) {
        return yield* badRequest(
          `mouse: ticks must be an integer in 1..${String(MAX_TICKS)}`,
          live,
        );
      }
      yield* followed(
        live,
        `mouse-${gesture._tag}`,
        live.qemu
          .mouse(gesture, recorder(live))
          .pipe(Effect.mapError((error) => exchangeFailed(error, live))),
      ).pipe(Effect.tapError(() => endIfGone(live)));
      return yield* log.info(
        `mouse ${gesture._tag} ${describeGesture(gesture)} in ${yield* elapsed(started)}ms`,
        { location: live.id, agentId: live.agent },
      );
    });

    const intentStart = Effect.fn("Sessions.intentStart")(function* (
      live: LiveSession,
      testResultId: string,
      message: string,
    ) {
      if (Option.isSome(yield* Ref.get(live.intent))) {
        return yield* badRequest(
          "Cannot start one intent when one's already running. Please end your previous intent.",
          live,
        );
      }
      const span = yield* Sentry.intentSpan(live.span, live.id, live.agent, testResultId, message);
      yield* Ref.set(live.intent, Option.some({ span, message }));
      yield* emit(live, { type: "intent", state: "started", message });
      return yield* log.info(`intent start; ${message}`, {
        location: live.id,
        agentId: live.agent,
      });
    });

    const intentEnd = Effect.fn("Sessions.intentEnd")(function* (live: LiveSession) {
      if (Option.isNone(yield* Ref.get(live.intent))) {
        return yield* badRequest("no active intent", live);
      }
      yield* finishOpenIntent(live, "completed");
      return yield* log.info("intent end", { location: live.id, agentId: live.agent });
    });

    const readSerialText = (live: LiveSession): Effect.Effect<string> =>
      fs.readFile(live.qemu.serialPath).pipe(
        Effect.map((bytes) => new TextDecoder().decode(bytes)),
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed("")
            : log
                .error(`debug log: serial read failed: ${detail(error)}`, {
                  location: live.id,
                  agentId: live.agent,
                  cause: error,
                })
                .pipe(Effect.as("")),
        ),
      );

    type Captured = { readonly serial: string; readonly qemu: string };

    // What vanishes with the machine, read before the kill: the console file and QEMU's stderr.
    const captureDebugLog = (live: LiveSession): Effect.Effect<Captured> =>
      Effect.all({ serial: readSerialText(live), qemu: live.qemu.stderrTail });

    const saveDebugLog = (live: LiveSession, captured: Captured): Effect.Effect<void> =>
      Effect.gen(function* () {
        // Drain the log queue so the snapshot includes the stopped line just offered.
        yield* log.flush;
        yield* debugLogs.saveDebugLog(live.id, captured).pipe(
          Effect.catch((error) =>
            log.error(`debug log save failed: ${detail(error)}`, {
              location: live.id,
              agentId: live.agent,
              cause: error,
            }),
          ),
        );
      });

    // A dead QEMU is noticed by the next exchange failing. That is the system failing, not the
    // driver's verdict, so the session ends errored here and its driver's next request is 404.
    // The caller still gets the exchange's own failure.
    const endIfGone = (live: LiveSession): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (yield* live.qemu.running) {
          return;
        }
        const owned = yield* Ref.modify(sessions, (map) =>
          map.has(live.id) ? [true, mapWithout(map, [live.id])] : [false, map],
        );
        if (!owned) {
          return;
        }
        const code = yield* live.qemu.exited;
        const reason = `qemu exited ${code === null ? "on a signal" : String(code)}`;
        const captured = yield* captureDebugLog(live);
        yield* killLogged(live, "errored cleanup failed", live.agent);
        yield* sessionStore.endSession(live.id, "errored", reason).pipe(
          Effect.catch((failure) =>
            log.error(`db: recording an errored session failed too: ${failure.message}`, {
              location: live.id,
              agentId: live.agent,
              cause: failure,
            }),
          ),
        );
        yield* log.info(`stopped; errored; ${reason}`, attribution(live.id, live.agent));
        yield* saveDebugLog(live, captured);
        yield* finishLiveSession(live, "errored");
      });

    const stop = Effect.fn("Sessions.stop")(function* (
      live: LiveSession,
      status: Domain.StopStatus | undefined,
      reason: string | undefined,
    ) {
      // The sweep may have taken the session between the lookup and here; whoever removes the id
      // owns its one verdict, and the other caller sees the session as already gone.
      const owned = yield* Ref.modify(sessions, (map) =>
        map.has(live.id) ? [true, mapWithout(map, [live.id])] : [false, map],
      );
      if (!owned) {
        return yield* Errors.unknownSession(live.id, live.agent);
      }
      return yield* close(live, status ?? "aborted", reason);
    });

    // Ends a session its caller has just taken out of the map, so the verdict is this one. Every
    // end but a succeeded stop is a session to explain. The session dir dies with kill; the
    // serial has to be read while the file still exists. QEMU stderr is the in-memory tail
    // drained so far. Reading it after kill is racy: closing the scope interrupts the drain
    // fiber, so a death line written on SIGTERM can be lost.
    const close = (
      live: LiveSession,
      finalStatus: Domain.StopStatus,
      reason: string | undefined,
    ): Effect.Effect<void, Errors.Internal> =>
      Effect.gen(function* () {
        const captured = yield* captureDebugLog(live);
        // The kill destroys the socket and signals QEMU before it removes the dir, so a cleanup
        // failure still leaves a dead machine: log it, but close the record.
        yield* killLogged(live, "stop cleanup failed", live.agent);
        yield* sessionStore
          .endSession(live.id, finalStatus, reason ?? null)
          .pipe(
            Effect.catch((cause) =>
              finishLiveSession(live, finalStatus).pipe(
                Effect.andThen(Effect.fail(internal(cause, live.id, live.agent))),
              ),
            ),
          );
        // Colour is released in finishLiveSession; log first so the stopped line keeps it.
        yield* log.info(`stopped; ${finalStatus}${reason === undefined ? "" : `; ${reason}`}`, {
          location: live.id,
          agentId: live.agent,
        });
        yield* saveDebugLog(live, captured);
        return yield* finishLiveSession(live, finalStatus);
      });

    // -------------------------------------------------------------------------
    // relinquish
    // -------------------------------------------------------------------------

    // Gives back everything this agent holds here: an unused reservation, and the session it is
    // running, which is stopped as aborted so the machine, the record and the slot close together
    // rather than the slot going back with a guest still on it. The session is taken out of the
    // map here, as stop does, so this is its one verdict. Holding nothing is BadRequest; a start
    // in flight holds neither yet and keeps its slot.
    const relinquish = Effect.fn("Sessions.relinquish")(function* (agent: string) {
      const released = yield* Ref.modify(slots, (held) =>
        held.reserved.has(agent)
          ? ([
              true,
              { count: held.count - 1, reserved: mapWithout(held.reserved, [agent]) },
            ] as const)
          : ([false, held] as const),
      );
      const running = yield* Ref.modify(sessions, (map) => {
        const live = Option.fromUndefinedOr(
          [...map.values()].find((candidate) => candidate.agent === agent),
        );
        return [live, Option.isNone(live) ? map : mapWithout(map, [live.value.id])] as const;
      });
      if (!released && Option.isNone(running)) {
        return yield* Errors.BadRequest.make({ message: "no reservation", agentId: agent });
      }
      return yield* Option.match(running, {
        onNone: () => Effect.void,
        onSome: (live) => close(live, "aborted", RELINQUISH_REASON),
      });
    });

    // -------------------------------------------------------------------------
    // save
    // -------------------------------------------------------------------------

    const saveFailed = (message: string, live: LiveSession, cause?: unknown): Errors.SaveFailed =>
      Errors.SaveFailed.make(
        Object.assign(
          { message, sessionId: live.id, agentId: live.agent },
          cause === undefined ? undefined : { cause },
        ),
      );

    // A clean shutdown makes a clean disk: the power button, then QEMU's exit, then the copy. A
    // guest the driver already shut down needs no button, and a socket closing under the button
    // is a guest already on its way out.
    const powerOff = (live: LiveSession): Effect.Effect<void, Errors.SaveFailed> =>
      Effect.gen(function* () {
        if (yield* live.qemu.running) {
          yield* live.qemu.powerdown(recorder(live)).pipe(
            Effect.catchTag("QmpClosed", () => Effect.void),
            Effect.mapError((error) => saveFailed(detail(error), live, error)),
          );
        }
        yield* live.qemu.exited.pipe(
          Effect.timeoutOrElse({
            duration: SAVE_POWEROFF,
            orElse: () => Effect.fail(saveFailed(SAVE_POWEROFF_REASON, live)),
          }),
        );
      });

    const save = Effect.fn("Sessions.save")(function* (live: LiveSession) {
      if (live.mode === "resume") {
        return yield* badRequest(
          "a resumed session cannot save; its disk is a view of the minted one",
          live,
        );
      }
      // Whoever removes the id owns its one verdict, as in stop.
      const owned = yield* Ref.modify(sessions, (map) =>
        map.has(live.id) ? [true, mapWithout(map, [live.id])] : [false, map],
      );
      if (!owned) {
        return yield* Errors.unknownSession(live.id, live.agent);
      }
      const who = { sessionId: live.id, agentId: live.agent };
      // The disk is read while the session dir still exists; the kill comes after.
      const kept = yield* Effect.result(
        followed(
          live,
          "save",
          powerOff(live).pipe(
            Effect.andThen(
              minted.save(live.iso, { disk: live.qemu.diskPath, vars: live.qemu.varsPath }, who),
            ),
          ),
        ),
      );
      if (Result.isFailure(kept)) {
        const error = kept.failure;
        const captured = yield* captureDebugLog(live);
        yield* killLogged(live, "save cleanup failed", live.agent);
        // Best effort: the caller's error is what matters once the save has failed.
        yield* sessionStore.endSession(live.id, "errored", error.message).pipe(
          Effect.catch((failure) =>
            log.error(`db: recording a failed save failed too: ${failure.message}`, {
              location: live.id,
              agentId: live.agent,
              cause: failure,
            }),
          ),
        );
        yield* log.info(`stopped; errored; ${error.message}`, attribution(live.id, live.agent));
        yield* saveDebugLog(live, captured);
        yield* finishLiveSession(live, "errored");
        return yield* Effect.fail(error);
      }
      const captured = yield* captureDebugLog(live);
      yield* killLogged(live, "save cleanup failed", live.agent);
      const reason = `saved; minted ${live.iso}`;
      yield* sessionStore
        .endSession(live.id, "succeeded", reason)
        .pipe(
          Effect.catch((cause) =>
            finishLiveSession(live, "succeeded").pipe(
              Effect.andThen(Effect.fail(internal(cause, live.id, live.agent))),
            ),
          ),
        );
      // Colour is released in finishLiveSession; log first so the saved line keeps it.
      yield* log.info(reason, attribution(live.id, live.agent));
      yield* saveDebugLog(live, captured);
      return yield* finishLiveSession(live, "succeeded");
    });

    // -------------------------------------------------------------------------
    // follow
    // -------------------------------------------------------------------------

    const follow = Effect.fn("Sessions.follow")(function* (id: string) {
      const running = (yield* Ref.get(sessions)).get(id);
      const live = running ?? (yield* Ref.get(openSessions)).get(id);
      if (live === undefined) {
        const status = Domain.isSessionId(id)
          ? yield* sessionStore
              .getSessionStatus(id)
              .pipe(Effect.mapError((cause) => internal(cause, id)))
          : Option.none<Domain.SessionStatus>();
        if (Option.isNone(status)) {
          return yield* Errors.unknownSession(id);
        }
        // A row still downloading or running that this qemu server does not hold was booted by
        // another server, or by one that died with it.
        return yield* Errors.Conflict.make({
          message:
            status.value === "downloading" || status.value === "running"
              ? `session "${id}" is not running on this qemu server`
              : `session "${id}" has already completed (${status.value})`,
          sessionId: id,
        });
      }
      // Registered here, synchronously after the lookup, so a session that ends before the body
      // starts streaming still ends this queue rather than leaving it hanging.
      const queue = yield* Queue.dropping<Domain.FollowEvent, Cause.Done>(FOLLOW_BACKLOG);
      yield* Ref.update(live.followers, (set) => withItem(set, queue));
      // finishLiveSession leaves openSessions first and ends the followers last; a registration
      // that lands between those two steps would otherwise never be ended.
      if (!(yield* Ref.get(openSessions)).has(live.id)) {
        Queue.endUnsafe(queue);
      }
      yield* log.info("follower attached", { location: id, agentId: live.agent });
      Queue.offerUnsafe(queue, {
        type: "session",
        status: running === undefined ? "pending" : "running",
      });
      const intent = yield* Ref.get(live.intent);
      if (Option.isSome(intent)) {
        Queue.offerUnsafe(queue, {
          type: "intent",
          state: "started",
          message: intent.value.message,
        });
      }
      const latest = yield* Ref.get(live.image);
      if (Option.isSome(latest)) {
        Queue.offerUnsafe(queue, { type: "image", id: latest.value.id, png: latest.value.png });
      }
      return Stream.fromQueue(queue).pipe(Stream.ensuring(detach(live, queue)));
    });

    // -------------------------------------------------------------------------
    // the sweep
    // -------------------------------------------------------------------------

    const timeOut = (live: LiveSession): Effect.Effect<void, Errors.DatabaseError> =>
      Effect.gen(function* () {
        const captured = yield* captureDebugLog(live);
        // The kill already destroyed the socket and signalled QEMU, so still close the record.
        yield* killLogged(live, "timeout cleanup failed", undefined);
        yield* sessionStore
          .endSession(live.id, "timed_out", SESSION_TIMEOUT_REASON)
          .pipe(
            Effect.andThen(log.info(`timed out; ${SESSION_TIMEOUT_REASON}`, { location: live.id })),
            Effect.andThen(saveDebugLog(live, captured)),
            Effect.ensuring(finishLiveSession(live, "timed_out")),
          );
      });

    // Every reservation past the deadline leaves the reserved set and gives its slot back in one
    // step, so a start arriving late is refused rather than admitted twice.
    const expireReservations = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const expired = yield* Ref.modify(slots, (held) => {
        const gone: Array<string> = [];
        for (const [agent, since] of held.reserved) {
          if (now - since >= RESERVATION_TIMEOUT_MS) {
            gone.push(agent);
          }
        }
        return [
          gone,
          { count: held.count - gone.length, reserved: mapWithout(held.reserved, gone) },
        ] as const;
      });
      for (const agent of expired) {
        yield* log.warning(`reservation expired; ${RESERVATION_TIMEOUT_REASON}`, {
          location: Log.Locations.server,
          agentId: agent,
        });
      }
    });

    const sweep = Effect.gen(function* () {
      yield* expireReservations;
      const now = yield* Clock.currentTimeMillis;
      const timedOut: Array<LiveSession> = [];
      for (const live of (yield* Ref.get(sessions)).values()) {
        if (now - (yield* Ref.get(live.lastCommandAt)) >= SESSION_TIMEOUT_MS) {
          timedOut.push(live);
        }
      }
      if (timedOut.length === 0) {
        return;
      }
      // Only the candidates still in the map are this sweep's to end: a stop or relinquish that
      // took one since the look above owns its verdict, as whoever removes the id always does.
      const taken = yield* Ref.modify(sessions, (map) => {
        const owned = timedOut.filter((live) => map.has(live.id));
        return [
          owned,
          mapWithout(
            map,
            owned.map((live) => live.id),
          ),
        ] as const;
      });
      const settled = yield* Effect.forEach(
        taken,
        (live) => Effect.map(Effect.exit(timeOut(live)), (exit) => ({ live, exit })),
        { concurrency: "unbounded" },
      );
      for (const { live, exit } of settled) {
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          yield* log.error(`recording timeout failed: ${detail(error)}`, {
            location: live.id,
            cause: error,
          });
        }
      }
    });

    const guard = yield* Semaphore.make(1);
    // Uninterruptible so that shutdown's interrupt waits for a tick in flight instead of tearing it.
    const tick = sweep.pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`session timeout cleanup failed: ${detail(error)}`, {
          location: Log.Locations.server,
          cause: error,
        });
      }),
      Effect.uninterruptible,
      guard.withPermitsIfAvailable(1),
      Effect.asVoid,
    );
    const sweeper = yield* tick.pipe(
      Effect.repeat(Schedule.spaced(SESSION_TIMEOUT_CHECK)),
      Effect.forkScoped({ startImmediately: true }),
    );

    // -------------------------------------------------------------------------
    // restart
    // -------------------------------------------------------------------------

    // This process holds no session yet, so a row still downloading or running that the qemu
    // reverse proxy routed to this url was left by one that died. It is errored before the first
    // request, so a driver reads a finished session rather than a live one. A qemu server with
    // no url of its own has none routed to it. A cleanup that cannot write fails the startup.
    if (selfUrl !== undefined) {
      const ids = yield* sessionStore.failRoutedSessions(selfUrl, RESTART_REASON);
      yield* Effect.forEach(
        ids,
        (id) => log.error(`errored; ${RESTART_REASON}`, { location: id }),
        {
          discard: true,
        },
      );
    }

    // -------------------------------------------------------------------------
    // the drain
    // -------------------------------------------------------------------------

    const drainOne = (
      live: LiveSession,
      reason: string,
    ): Effect.Effect<void, Errors.DatabaseError> =>
      Effect.gen(function* () {
        const status = yield* Ref.make<Domain.SessionEndStatus>("errored");
        yield* Effect.gen(function* () {
          const captured = yield* captureDebugLog(live);
          yield* kill(live);
          yield* Ref.set(status, "aborted");
          yield* sessionStore.endSession(live.id, "aborted", reason);
          yield* log.info(`stopped; aborted; ${reason}`, { location: live.id });
          yield* saveDebugLog(live, captured);
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause);
            return log
              .error(`shutdown: ${Render.errorDetail(error)}`, { location: live.id, cause: error })
              .pipe(Effect.andThen(Effect.failCause(cause)));
          }),
          Effect.ensuring(
            Effect.flatMap(Ref.get(status), (ended) => finishLiveSession(live, ended)),
          ),
        );
      });

    const drain = Effect.gen(function* () {
      // Clear the sweep, then await one in flight: the tick is uninterruptible, so this waits.
      yield* Fiber.interrupt(sweeper);
      const draining = [...(yield* Ref.getAndSet(sessions, new Map())).values()];
      const reason = MutableRef.get(shutdown.reason);
      yield* log.info(`qemu server: shutting down; stopping ${String(draining.length)} sessions`, {
        location: Log.Locations.server,
      });
      const exits = yield* Effect.forEach(draining, (live) => Effect.exit(drainOne(live, reason)), {
        concurrency: "unbounded",
      });
      MutableRef.set(shutdown.failed, exits.some(Exit.isFailure));
    });
    yield* Effect.addFinalizer(() => drain);

    const service: SessionsService = {
      reserve,
      relinquish,
      start,
      lookup,
      image,
      serial,
      sendKeys,
      mouse,
      intentStart,
      intentEnd,
      stop,
      save,
      follow,
      stats: Effect.flatMap(Ref.get(sessions), (map) => stats.collect(map.size)),
      minted: (name) => Effect.map(minted.find(name), Option.isSome),
      jobs: Effect.map(Ref.get(slots), (held) => held.count),
    };
    return service;
  });

export class Sessions extends Context.Service<Sessions>()("@oligarchy/qemu-server/Sessions", {
  make,
}) {
  static readonly layer = (
    maxJobs: number,
    selfUrl?: string,
  ): Layer.Layer<
    Sessions,
    Errors.DatabaseError,
    | Qemu.Qemu
    | Iso.Iso
    | Minted.Minted
    | Stats.Stats
    | SessionStore.SessionStore
    | Actions.ActionStore
    | DebugLogs.DebugLogStore
    | Log.Log
    | FileSystem.FileSystem
  > => Layer.effect(this)(this.make(maxJobs, selfUrl));
}
