import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
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
import * as SessionStore from "../db/sessions.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Iso from "../qemu/iso.ts";
import * as Keys from "../qemu/keys.ts";
import * as Qemu from "../qemu/qemu.ts";
import * as Stats from "../qemu/stats.ts";
import type * as Qmp from "../qmp/client.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_CHECK = "10 seconds";
const SESSION_TIMEOUT_REASON = "no command received for 10 minutes";
const SHUTDOWN_REASON = "proxy shutdown";
// A click is two QMP exchanges and two action rows; cap the pulse count so one request cannot
// enqueue an unbounded amount of work.
const MAX_CLICKS = 100;
// Each chord is a QMP exchange and an action row, paced ~60ms apart; cap the count so one request
// cannot run for many minutes or write thousands of rows.
const MAX_KEYS = 1000;
// A follower this many events behind has stopped reading; it is dropped rather than letting its
// queue hold every image the session takes from then on.
const FOLLOW_BACKLOG = 64;
// The status message Sentry showed for a failed action, now the failure the action span ends with.
const ACTION_FAILED = "internal_error";

type Follower = Queue.Queue<Domain.FollowEvent, Cause.Done>;

type Intent = { readonly span: Tracer.Span; readonly message: string };

type Image = { readonly id: string; readonly png: string };

export type LiveSession = {
  readonly id: string;
  readonly agent: string;
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
  readonly start: (
    body: Contract.StartBody,
    display: Domain.QemuDisplay,
    automation: boolean,
  ) => Effect.Effect<string, Errors.StartFailed | Errors.Internal>;
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
  readonly dump: (
    id: string,
  ) => Effect.Effect<Uint8Array, Errors.UnknownSession | Errors.Conflict | Errors.Internal>;
  readonly sendKeys: (
    live: LiveSession,
    keys: string,
    encoding: string | undefined,
  ) => Effect.Effect<void, Errors.BadRequest | Errors.ExchangeFailed>;
  readonly sendMouse: (
    live: LiveSession,
    input: Contract.SendMouseBody,
  ) => Effect.Effect<void, Errors.BadRequest | Errors.ExchangeFailed>;
  readonly intentStart: (
    live: LiveSession,
    testResultId: string,
    message: string,
  ) => Effect.Effect<void, Errors.BadRequest>;
  readonly intentEnd: (live: LiveSession) => Effect.Effect<void, Errors.BadRequest>;
  readonly stop: (
    live: LiveSession,
    status: Domain.StopStatus | undefined,
    reason: string | undefined,
  ) => Effect.Effect<void, Errors.Internal>;
  readonly follow: (
    id: string,
  ) => Effect.Effect<
    Stream.Stream<Domain.FollowEvent>,
    Errors.UnknownSession | Errors.Conflict | Errors.Internal
  >;
  readonly stats: Effect.Effect<Contract.Stats>;
  readonly count: Effect.Effect<number>;
};

// What the drain finalizer reads and reports: the reason every surviving session's row is closed
// with (main's server error path replaces the default) and whether a session refused to close.
export type Shutdown = {
  readonly reason: Ref.Ref<string>;
  readonly failed: Ref.Ref<boolean>;
};

export const Shutdown = Context.Reference<Shutdown>("@oligarchy/proxy/sessions/Shutdown", {
  defaultValue: () => ({ reason: Ref.makeUnsafe(SHUTDOWN_REASON), failed: Ref.makeUnsafe(false) }),
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

const attribution = (sessionId: string, agentId: string | undefined): Log.Attribution =>
  agentId === undefined ? { sessionId } : { sessionId, agentId };

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

const isUrl = (iso: string): boolean => iso.startsWith("http://") || iso.startsWith("https://");

const make = Effect.gen(function* () {
  const qemu = yield* Qemu.Qemu;
  const iso = yield* Iso.Iso;
  const stats = yield* Stats.Stats;
  const sessionStore = yield* SessionStore.SessionStore;
  const actionStore = yield* Actions.ActionStore;
  const log = yield* Log.Log;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shutdown = yield* Shutdown;
  const scope = yield* Scope.Scope;

  // Running machines, by id; and every session this proxy holds, booting ones included.
  const sessions = yield* Ref.make<ReadonlyMap<string, LiveSession>>(new Map());
  const openSessions = yield* Ref.make<ReadonlyMap<string, OpenSession>>(new Map());
  // withActionSpan ends its span with the fiber that carries it; the handle that settles that fiber
  // lives here so LiveSession carries plain spans.
  const settlers = new Map<
    Tracer.Span,
    (state: Domain.ActionState, imageUrl: Option.Option<string>) => Effect.Effect<void>
  >();

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
          sessionId: live.id,
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
        yield* log.info("follower detached", { sessionId: live.id, agentId: live.agent });
      }
    });

  // -------------------------------------------------------------------------
  // action spans and the recorder
  // -------------------------------------------------------------------------

  const openActionSpan = (
    live: OpenSession,
    command: Domain.QmpCommand,
  ): Effect.Effect<Tracer.Span> =>
    Effect.gen(function* () {
      const parent = Option.match(yield* Ref.get(live.intent), {
        onNone: () => live.span,
        onSome: (intent) => intent.span,
      });
      const ready = yield* Deferred.make<Tracer.Span>();
      const settled = yield* Deferred.make<Option.Option<string>, string>();
      // The span lives as long as this fiber: from the recorder opening to its close.
      const fiber = yield* Effect.gen(function* () {
        yield* Deferred.succeed(ready, yield* Effect.orDie(Effect.currentSpan));
        const imageUrl = yield* Deferred.await(settled);
        if (Option.isSome(imageUrl)) {
          yield* Sentry.annotateImageUrl(imageUrl.value);
        }
      }).pipe(
        Sentry.withActionSpan(parent, command.execute, live.id, live.agent),
        Effect.ignore,
        Effect.forkIn(scope, { startImmediately: true }),
      );
      const span = yield* Deferred.await(ready);
      settlers.set(span, (state, imageUrl) =>
        (state === "completed"
          ? Deferred.succeed(settled, imageUrl)
          : Deferred.fail(settled, ACTION_FAILED)
        ).pipe(Effect.andThen(Fiber.await(fiber)), Effect.asVoid),
      );
      yield* Ref.update(live.actionSpans, (spans) => withItem(spans, span));
      return span;
    });

  const settleActionSpan = (
    live: OpenSession,
    span: Tracer.Span,
    state: Domain.ActionState,
    imageUrl: Option.Option<string>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const open = yield* Ref.modify(live.actionSpans, (spans) =>
        spans.has(span) ? [true, without(spans, span)] : [false, spans],
      );
      if (!open) {
        return;
      }
      const settle = settlers.get(span);
      settlers.delete(span);
      if (settle !== undefined) {
        yield* settle(state, imageUrl);
      }
    });

  // Opens the span and the action row; a refused insert fails the exchange up front.
  const beginAction = (live: OpenSession, command: Domain.QmpCommand) =>
    Effect.gen(function* () {
      const span = yield* openActionSpan(live, command);
      const id = yield* actionStore
        .startAction({ sessionId: live.id, agentId: live.agent, request: command })
        .pipe(Effect.tapError(() => settleActionSpan(live, span, "failed", Option.none())));
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
              yield* settleActionSpan(live, span, outcome.state, Option.none());
              yield* actionStore.finishAction(id, outcome).pipe(
                Effect.tapError((error) =>
                  log.error(`db: closing action ${String(id)} failed: ${detail(error)}`, {
                    sessionId: live.id,
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
      yield* log.releaseColor(live.agent);
      for (const span of yield* Ref.get(live.actionSpans)) {
        yield* settleActionSpan(live, span, "failed", Option.none());
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
      const disk = body.disk;
      if (disk !== undefined) {
        yield* fs
          .stat(disk)
          .pipe(
            Effect.mapError(() =>
              Errors.QemuStartError.make({ message: `qemu: disk not found: ${disk}` }),
            ),
          );
      }
      const isoPath = yield* iso.getIso(body.iso, { sessionId: live.id, agentId: live.agent });
      // Register right before boot: the handshake records an action that references agent_runs,
      // so this must precede start(), but a failed download before here must not burn the agent
      // id on its one-registration key.
      yield* sessionStore.registerAgent(live.agent, live.id);
      const base = {
        id: live.id,
        iso: isoPath,
        display,
        automation,
        record: recorder(live),
      };
      const handle = yield* qemu
        .start(disk === undefined ? base : { ...base, disk })
        .pipe(Scope.provide(live.scope));
      yield* sessionStore.sessionRunning(live.id);
      return handle;
    }).pipe(
      Effect.tapError((error) =>
        Effect.gen(function* () {
          // Best effort: the row and the caller's error are what matter once boot has failed.
          yield* Effect.ignore(kill(live));
          yield* sessionStore.endSession(live.id, "failed", detail(error)).pipe(
            Effect.catch((failure) =>
              log.error(`db: recording a failed start failed too: ${failure.message}`, {
                sessionId: live.id,
                agentId: live.agent,
                cause: failure,
              }),
            ),
          );
        }),
      ),
    );

  const start = Effect.fn("Sessions.start")(function* (
    body: Contract.StartBody,
    display: Domain.QemuDisplay,
    automation: boolean,
  ) {
    const started = yield* Clock.currentTimeMillis;
    const id: string = crypto.randomUUID();
    const agent = body.agent;
    const live: OpenSession = {
      id,
      agent,
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
    const disk = body.disk;
    yield* sessionStore
      .insertSession(
        id,
        disk === undefined ? { iso: body.iso } : { iso: body.iso, disk },
        isUrl(body.iso) ? "downloading" : "running",
      )
      .pipe(
        Effect.catch((cause) =>
          finishLiveSession(live, "failed").pipe(
            Effect.andThen(Effect.fail(internal(cause, id, agent))),
          ),
        ),
      );
    yield* log.info(`starting; iso ${body.iso}${disk === undefined ? "" : `, disk ${disk}`}`, {
      sessionId: id,
      agentId: agent,
    });
    const handle = yield* launch(live, body, display, automation).pipe(
      Effect.catch((error) =>
        finishLiveSession(live, "failed").pipe(
          Effect.andThen(
            Effect.fail(
              Errors.StartFailed.make({
                message: detail(error),
                cause: error,
                sessionId: id,
                agentId: agent,
              }),
            ),
          ),
        ),
      ),
    );
    const running: LiveSession = { ...live, qemu: handle };
    yield* Ref.set(running.lastCommandAt, yield* Clock.currentTimeMillis);
    yield* Ref.update(sessions, (map) => mapWith(map, id, running));
    yield* emit(running, { type: "session", status: "running" });
    yield* log.info(`running; started in ${yield* elapsed(started)}ms`, {
      sessionId: id,
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
              result.state === "completed" ? Option.some(url) : Option.none(),
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
            sessionId: live.id,
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
        { sessionId: live.id, agentId: live.agent },
      );
      return { png, imageId };
    });
    return yield* followed(live, "get-image", work);
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
      sessionId: live.id,
      agentId: live.agent,
    });
    return data;
  });

  const dump = Effect.fn("Sessions.dump")(function* (id: string) {
    const started = yield* Clock.currentTimeMillis;
    if (!Domain.isSessionId(id)) {
      return yield* Errors.unknownSession(id);
    }
    const live = Option.fromUndefinedOr((yield* Ref.get(sessions)).get(id));
    const agent = Option.getOrUndefined(Option.map(live, (running) => running.agent));
    // A session this proxy no longer holds may still have its directory: a proxy that died
    // mid-session never removed it, and its QEMU kept writing the console.
    const target = Option.match(live, {
      onNone: () => path.join(qemu.sessionDir(id), "serial.log"),
      onSome: (running) => running.qemu.serialPath,
    });
    const data = yield* fs.readFile(target).pipe(
      Effect.mapError((error) =>
        error.reason._tag === "NotFound"
          ? Errors.Conflict.make({
              message: `session "${id}" has no console on this proxy`,
              sessionId: id,
            })
          : internal(error, id, agent),
      ),
    );
    yield* log.info(
      `dump; ${String(data.length)} bytes from ${Option.isNone(live) ? "disk" : "the running machine"} in ${yield* elapsed(started)}ms`,
      attribution(id, agent),
    );
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
    );
    return yield* log.info(`sent ${String(chords.length)} chords in ${yield* elapsed(started)}ms`, {
      sessionId: live.id,
      agentId: live.agent,
    });
  });

  const sendMouse = Effect.fn("Sessions.sendMouse")(function* (
    live: LiveSession,
    input: Contract.SendMouseBody,
  ) {
    const started = yield* Clock.currentTimeMillis;
    const { x, y, button, clicks } = input;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      return yield* badRequest("mouse: x and y must be in 0..1", live);
    }
    if (clicks !== undefined && (!Number.isInteger(clicks) || clicks < 1 || clicks > MAX_CLICKS)) {
      return yield* badRequest(
        `mouse: clicks must be an integer in 1..${String(MAX_CLICKS)}`,
        live,
      );
    }
    const gesture = Object.assign(
      { x, y },
      button === undefined ? undefined : { button },
      clicks === undefined ? undefined : { clicks },
    );
    yield* followed(
      live,
      "send-mouse",
      live.qemu
        .sendMouse(gesture, recorder(live))
        .pipe(Effect.mapError((error) => exchangeFailed(error, live))),
    );
    const pulses = clicks === undefined || clicks === 1 ? "" : ` ×${String(clicks)}`;
    return yield* log.info(
      `mouse ${String(x)} ${String(y)}${button === undefined ? "" : ` ${button}${pulses}`} in ${yield* elapsed(started)}ms`,
      { sessionId: live.id, agentId: live.agent },
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
      sessionId: live.id,
      agentId: live.agent,
    });
  });

  const intentEnd = Effect.fn("Sessions.intentEnd")(function* (live: LiveSession) {
    if (Option.isNone(yield* Ref.get(live.intent))) {
      return yield* badRequest("no active intent", live);
    }
    yield* finishOpenIntent(live, "completed");
    return yield* log.info("intent end", { sessionId: live.id, agentId: live.agent });
  });

  const stop = Effect.fn("Sessions.stop")(function* (
    live: LiveSession,
    status: Domain.StopStatus | undefined,
    reason: string | undefined,
  ) {
    const finalStatus = status ?? "aborted";
    yield* Ref.update(sessions, (map) => mapWithout(map, [live.id]));
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
      sessionId: live.id,
      agentId: live.agent,
    });
    yield* finishLiveSession(live, finalStatus);
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
      // A row still downloading or running that this proxy does not hold was booted by another
      // proxy, or by one that died with it.
      return yield* Errors.Conflict.make({
        message:
          status.value === "downloading" || status.value === "running"
            ? `session "${id}" is not running on this proxy`
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
    yield* log.info("follower attached", { sessionId: id, agentId: live.agent });
    Queue.offerUnsafe(queue, {
      type: "session",
      status: running === undefined ? "pending" : "running",
    });
    const intent = yield* Ref.get(live.intent);
    if (Option.isSome(intent)) {
      Queue.offerUnsafe(queue, { type: "intent", state: "started", message: intent.value.message });
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
      // The kill already destroyed the socket and signalled QEMU, so still close the record.
      yield* killLogged(live, "timeout cleanup failed", undefined);
      yield* sessionStore
        .endSession(live.id, "timed_out", SESSION_TIMEOUT_REASON)
        .pipe(
          Effect.andThen(log.info(`timed out; ${SESSION_TIMEOUT_REASON}`, { sessionId: live.id })),
          Effect.ensuring(finishLiveSession(live, "timed_out")),
        );
    });

  const sweep = Effect.gen(function* () {
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
    yield* Ref.update(sessions, (map) =>
      mapWithout(
        map,
        timedOut.map((live) => live.id),
      ),
    );
    const settled = yield* Effect.forEach(
      timedOut,
      (live) => Effect.map(Effect.exit(timeOut(live)), (exit) => ({ live, exit })),
      { concurrency: "unbounded" },
    );
    for (const { live, exit } of settled) {
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        yield* log.error(`recording timeout failed: ${detail(error)}`, {
          sessionId: live.id,
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
      return log.error(`session timeout cleanup failed: ${detail(error)}`, { cause: error });
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
  // the drain
  // -------------------------------------------------------------------------

  const drainOne = (live: LiveSession, reason: string): Effect.Effect<void, Errors.DatabaseError> =>
    Effect.gen(function* () {
      const status = yield* Ref.make<Domain.SessionEndStatus>("failed");
      yield* Effect.gen(function* () {
        yield* kill(live);
        yield* Ref.set(status, "aborted");
        yield* sessionStore.endSession(live.id, "aborted", reason);
        yield* log.info(`stopped; aborted; ${reason}`, { sessionId: live.id });
      }).pipe(
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);
          return log
            .error(`shutdown: ${Render.errorDetail(error)}`, { sessionId: live.id, cause: error })
            .pipe(Effect.andThen(Effect.failCause(cause)));
        }),
        Effect.ensuring(Effect.flatMap(Ref.get(status), (ended) => finishLiveSession(live, ended))),
      );
    });

  const drain = Effect.gen(function* () {
    // Clear the sweep, then await one in flight: the tick is uninterruptible, so this waits.
    yield* Fiber.interrupt(sweeper);
    const draining = [...(yield* Ref.getAndSet(sessions, new Map())).values()];
    const reason = yield* Ref.get(shutdown.reason);
    yield* log.info(`proxy: shutting down; stopping ${String(draining.length)} sessions`);
    const exits = yield* Effect.forEach(draining, (live) => Effect.exit(drainOne(live, reason)), {
      concurrency: "unbounded",
    });
    yield* Ref.set(shutdown.failed, exits.some(Exit.isFailure));
  });
  yield* Effect.addFinalizer(() => drain);

  const service: SessionsService = {
    start,
    lookup,
    image,
    serial,
    dump,
    sendKeys,
    sendMouse,
    intentStart,
    intentEnd,
    stop,
    follow,
    stats: Effect.flatMap(Ref.get(sessions), (map) => stats.collect(map.size)),
    count: Effect.map(Ref.get(sessions), (map) => map.size),
  };
  return service;
});

export class Sessions extends Context.Service<Sessions>()("@oligarchy/proxy/Sessions", { make }) {
  static readonly layer: Layer.Layer<
    Sessions,
    never,
    | Qemu.Qemu
    | Iso.Iso
    | Stats.Stats
    | SessionStore.SessionStore
    | Actions.ActionStore
    | Log.Log
    | FileSystem.FileSystem
    | Path.Path
  > = Layer.effect(this)(this.make);
}
