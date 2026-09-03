import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { flushLogs, log } from "../db/log.ts";
import { connectDatabase, endSession, finishAction, insertSession, pingDatabase, registerAgent, sessionRunning, startAction } from "../db/ops.ts";
import { finishIntentSpan, finishQemuActionSpan, finishQemuSpan, flushSentry, initSentry, startIntentSpan, startQemuActionSpan, startQemuSpan, type QemuSpan } from "../sentry.ts";
import { QEMU_DISPLAYS, createDisk, createQemu, missingHostRequirements, screendump, sendKeys, sendMouse, start, stop, type Qemu, type QemuDisplay } from "./client.ts";
import { getIso } from "./iso.ts";
import { parseKeys } from "./keys.ts";
import { collectStats, startCpuSampler } from "./stats.ts";

if (existsSync(".env")) {
  loadEnvFile();
}

const token = process.env.OLIGARCHY_TOKEN;
if (token === undefined || token === "") {
  throw new Error("OLIGARCHY_TOKEN is not set");
}

initSentry();

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 42069;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_CHECK_MS = 10_000;
const SESSION_TIMEOUT_REASON = "no command received for 10 minutes";
// A click is two QMP exchanges and two action rows; cap the pulse count so one
// request cannot enqueue an unbounded amount of work.
const MAX_CLICKS = 100;
// Each chord is a QMP exchange and an action row, paced ~60ms apart; cap the count so
// one request cannot run for many minutes or write thousands of rows.
const MAX_KEYS = 1000;

const db = connectDatabase();

type LiveSession = {
  qemu: Qemu;
  agent: string;
  lastCommandAt: number;
  span: QemuSpan;
  intent?: QemuSpan;
  actionSpans: Set<QemuSpan>;
};

function finishOpenIntent(live: LiveSession, status: "completed" | "cancelled"): void {
  if (live.intent === undefined) {
    return;
  }
  finishIntentSpan(live.intent, status);
  live.intent = undefined;
}

const sessions = new Map<string, LiveSession>();
const openSessions = new Set<LiveSession>();
const cpuSampler = startCpuSampler();

function finishLiveActionSpan(
  live: LiveSession,
  span: QemuSpan,
  state: QemuExchangeOutcome["state"],
): void {
  if (!live.actionSpans.delete(span)) {
    return;
  }
  finishQemuActionSpan(span, state);
}

function finishLiveSession(live: LiveSession, status: SessionEndStatus): void {
  openSessions.delete(live);
  for (const span of live.actionSpans) {
    finishLiveActionSpan(live, span, "failed");
  }
  finishOpenIntent(live, "cancelled");
  finishQemuSpan(live.span, status);
}

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
function errorDetail(err: unknown): string {
  const e = err as Error;
  return e.cause instanceof Error ? e.cause.message : e.message;
}

function recorder(live: LiveSession): QemuExchangeRecorder {
  return async (command) => {
    const sessionId = live.qemu.id;
    const agentId = live.agent;
    const span = startQemuActionSpan(live.intent ?? live.span, sessionId, agentId, command.execute);
    live.actionSpans.add(span);
    let id: number;
    try {
      id = await startAction(db, { sessionId, agentId, request: command });
    } catch (err) {
      finishLiveActionSpan(live, span, "failed");
      throw err;
    }
    return async (outcome) => {
      finishLiveActionSpan(live, span, outcome.state);
      try {
        await finishAction(db, id, outcome);
      } catch (err) {
        log(db, { level: "error", text: `db: closing action ${id} failed: ${errorDetail(err)}`, sessionId, agentId }, { cause: err });
        throw err;
      }
    };
  };
}

type ApiError =
  | { readonly _tag: "BadRequest"; readonly message: string; readonly sessionId?: string; readonly agentId?: string }
  | { readonly _tag: "UnknownSession"; readonly id: string; readonly agentId?: string }
  | { readonly _tag: "Forbidden"; readonly message: string; readonly sessionId: string; readonly agentId: string }
  | { readonly _tag: "StartFailed"; readonly message: string; readonly cause: unknown; readonly sessionId: string; readonly agentId: string }
  | { readonly _tag: "ExchangeFailed"; readonly message: string; readonly cause: unknown; readonly sessionId: string; readonly agentId: string }
  | { readonly _tag: "Internal"; readonly cause: unknown; readonly sessionId: string; readonly agentId?: string }
  | { readonly _tag: "Failed"; readonly message: string; readonly sessionId: string; readonly agentId: string };

function badRequest(message: string, who: { sessionId?: string; agentId?: string } = {}): ApiError {
  return { _tag: "BadRequest", message, ...who };
}

function failed(message: string, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "Failed", message, ...who };
}

function startFailed(err: unknown, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "StartFailed", message: errorDetail(err), cause: err, ...who };
}

function exchangeFailed(err: unknown, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "ExchangeFailed", message: errorDetail(err), cause: err, ...who };
}

function internal(cause: unknown, who: { sessionId: string; agentId?: string }): ApiError {
  return { _tag: "Internal", cause, ...who };
}

function session(id: string, agentId: string): Effect.Effect<LiveSession, ApiError> {
  if (id === "") {
    return Effect.fail(badRequest("session id is required", { agentId }));
  }
  const live = sessions.get(id);
  if (live === undefined) {
    return Effect.fail({ _tag: "UnknownSession", id, agentId });
  }
  if (live.agent !== agentId) {
    return Effect.fail({
      _tag: "Forbidden",
      message: `agent "${agentId}" does not own session "${id}"`,
      sessionId: id,
      agentId,
    });
  }
  // A valid request counts as activity even when the exchange it starts later fails.
  live.lastCommandAt = Date.now();
  return Effect.succeed(live);
}

const StartBody = Schema.Struct({
  iso: Schema.NonEmptyString,
  disk: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
});

const ImageParams = Schema.Struct({
  id: Schema.String,
  agent: Schema.NonEmptyString,
});

const SendKeysBody = Schema.Struct({
  id: Schema.String,
  keys: Schema.String,
  encoding: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
});

const SendMouseBody = Schema.Struct({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optionalKey(Schema.Literals(["left", "middle", "right", "wheel-up", "wheel-down"])),
  clicks: Schema.optionalKey(Schema.Number),
  agent: Schema.NonEmptyString,
});

const StopBody = Schema.Struct({
  id: Schema.String,
  agent: Schema.NonEmptyString,
  status: Schema.optionalKey(Schema.Literals(["succeeded", "failed", "aborted"])),
  reason: Schema.optionalKey(Schema.String),
});

const IntentStartBody = Schema.Struct({
  id: Schema.String,
  agent: Schema.NonEmptyString,
  test_result_id: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
});

const IntentEndBody = Schema.Struct({
  id: Schema.String,
  agent: Schema.NonEmptyString,
});

// JSON.parse instead of the platform's request.json: its error names the exact spot the body went wrong.
function jsonBody<S extends Schema.Constraint>(
  schema: S,
): Effect.Effect<S["Type"], ApiError, HttpServerRequest.HttpServerRequest | S["DecodingServices"]> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const raw = yield* Effect.mapError(request.text, (err) => badRequest(err.message));
    const body = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (err) => badRequest((err as Error).message),
    });
    return yield* Effect.mapError(Schema.decodeUnknownEffect(schema)(body), (err) => badRequest(err.message));
  });
}

type RouteHandler = Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, HttpRouter.Provided>;

async function launchQemu(
  live: LiveSession,
  cfg: typeof StartBody.Type,
): Promise<void> {
  const qemu = live.qemu;
  try {
    const iso = await getIso(db, cfg.iso, { sessionId: qemu.id, agentId: cfg.agent });
    if (cfg.disk === undefined) {
      await createDisk(qemu);
    } else {
      // start() expects the session dir; with a caller-provided disk, createDisk never made it.
      await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
    }
    // Register right before boot: the handshake records an action that references
    // agent_runs, so this must precede start(), but a failed download or disk
    // create before here must not burn the agent id on its one-registration key.
    await registerAgent(db, cfg.agent, qemu.id);
    await start(qemu, { iso, disk: cfg.disk }, recorder(live));
    await sessionRunning(db, qemu.id);
  } catch (err) {
    await stop(qemu).catch(() => {});
    await endSession(db, qemu.id, "failed", errorDetail(err)).catch((e: unknown) => {
      log(db, { level: "error", text: `db: recording a failed start failed too: ${(e as Error).message}`, sessionId: qemu.id, agentId: cfg.agent }, { cause: e });
    });
    throw err;
  }
}

function startSession(cfg: typeof StartBody.Type, started: number, display: QemuDisplay, automation: boolean): Effect.Effect<string, ApiError> {
  return Effect.gen(function* () {
    const isUrl = cfg.iso.startsWith("http://") || cfg.iso.startsWith("https://");
    const qemu = createQemu({ display, automation });
    const span = startQemuSpan(qemu.id, cfg.agent);
    const live = { qemu, agent: cfg.agent, lastCommandAt: Date.now(), span, actionSpans: new Set<QemuSpan>() };
    openSessions.add(live);
    yield* Effect.tryPromise({
      try: () => insertSession(db, qemu.id, { iso: cfg.iso, disk: cfg.disk }, isUrl ? "downloading" : "running"),
      catch: (cause) => {
        finishLiveSession(live, "failed");
        return internal(cause, { sessionId: qemu.id, agentId: cfg.agent });
      },
    });
    log(db, {
      text: `session ${qemu.id}: starting; iso ${cfg.iso}${cfg.disk === undefined ? "" : `, disk ${cfg.disk}`}`,
      sessionId: qemu.id,
      agentId: cfg.agent,
    });
    yield* Effect.tryPromise({
      try: () => launchQemu(live, cfg),
      catch: (err) => {
        finishLiveSession(live, "failed");
        return startFailed(err, { sessionId: qemu.id, agentId: cfg.agent });
      },
    });
    live.lastCommandAt = Date.now();
    sessions.set(qemu.id, live);
    log(db, { text: `session ${qemu.id}: running; started in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: cfg.agent });
    return qemu.id;
  });
}

// The session-driving routes are uninterruptible: a client disconnect interrupts the
// request's fiber, and a state transition torn in half leaves a machine the sessions
// map never received — unreachable and unkillable — or a kill that went unrecorded.
const routes = (display: QemuDisplay, automation: boolean) => HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("POST", "/start", Effect.gen(function* () {
      const started = Date.now();
      const cfg = yield* jsonBody(StartBody);
      const id = yield* startSession(cfg, started, display, automation);
      return HttpServerResponse.jsonUnsafe({ id });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("GET", "/image", Effect.gen(function* () {
      const started = Date.now();
      const params = yield* Effect.mapError(HttpRouter.schemaParams(ImageParams), (err) => badRequest(err.message));
      const live = yield* session(params.id, params.agent);
      const qemu = live.qemu;
      const agent = params.agent;
      const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
      // The images row must ride the same transaction that closes the action (they are
      // 1:1), so the recorder only stashes and the route closes.
      let opened: number | undefined;
      let outcome: QemuExchangeOutcome | undefined;
      let actionSpan: QemuSpan | undefined;
      const png = Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            screendump(qemu, path, "png", async (command) => {
              actionSpan = startQemuActionSpan(live.intent ?? live.span, qemu.id, agent, command.execute);
              live.actionSpans.add(actionSpan);
              try {
                opened = await startAction(db, { sessionId: qemu.id, agentId: agent, request: command });
              } catch (err) {
                finishLiveActionSpan(live, actionSpan, "failed");
                throw err;
              }
              return async (result) => {
                outcome = result;
                finishLiveActionSpan(live, actionSpan!, result.state);
              };
            }),
          catch: (err) => exchangeFailed(err, { sessionId: qemu.id, agentId: agent }),
        }).pipe(
          // Only a failed exchange is closed without an image; a completed one whose
          // image write failed stays open rather than break the 1:1 promise.
          Effect.tapError(() =>
            Effect.promise(async () => {
              if (opened !== undefined && outcome !== undefined && outcome.state === "failed") {
                await finishAction(db, opened, outcome).catch((e: unknown) => {
                  log(db, { level: "error", text: `db: recording a failed screendump failed too: ${(e as Error).message}`, sessionId: qemu.id, agentId: agent }, { cause: e });
                });
              }
            })
          ),
        );
        const data = yield* Effect.tryPromise({
          try: async () => {
            const data = await readFile(path);
            // screendump resolved, so the recorder ran: opened and outcome are set.
            await finishAction(db, opened!, outcome!, data);
            return data;
          },
          catch: (cause) => {
            return internal(cause, { sessionId: qemu.id, agentId: agent });
          },
        });
        log(db, { text: `session ${qemu.id}: image; ${data.length} bytes in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
        return HttpServerResponse.uint8Array(data, { contentType: "image/png" });
      });
      return yield* Effect.ensuring(png, Effect.promise(() => rm(path, { force: true })));
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("GET", "/serial", Effect.gen(function* () {
      const started = Date.now();
      const params = yield* Effect.mapError(HttpRouter.schemaParams(ImageParams), (err) => badRequest(err.message));
      const { qemu } = yield* session(params.id, params.agent);
      const data = yield* Effect.tryPromise({
        try: () => readFile(qemu.serialPath),
        catch: (cause) => internal(cause, { sessionId: qemu.id, agentId: params.agent }),
      });
      log(db, { text: `session ${qemu.id}: serial; ${data.length} bytes in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: params.agent });
      return HttpServerResponse.uint8Array(data, { contentType: "text/plain" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("GET", "/stats", Effect.sync(() => HttpServerResponse.jsonUnsafe(collectStats(cpuSampler, sessions.size))) satisfies RouteHandler);

    yield* router.add("POST", "/stop", Effect.gen(function* () {
      const { id, agent, status, reason } = yield* jsonBody(StopBody);
      const live = yield* session(id, agent);
      const qemu = live.qemu;
      const finalStatus = status ?? "aborted";
      sessions.delete(qemu.id);
      // stop() destroys the socket and signals QEMU before it removes the dir, so
      // a cleanup failure still leaves a dead machine: log it, but close the record.
      yield* Effect.promise(async () => {
        try {
          await stop(qemu);
        } catch (err) {
          log(db, { level: "error", text: `session ${qemu.id}: stop cleanup failed: ${errorDetail(err)}`, sessionId: qemu.id, agentId: agent }, { cause: err });
        }
      });
      yield* Effect.tryPromise({
        try: () => endSession(db, qemu.id, finalStatus, reason ?? null),
        catch: (cause) => {
          finishLiveSession(live, finalStatus);
          return internal(cause, { sessionId: qemu.id, agentId: agent });
        },
      });
      finishLiveSession(live, finalStatus);
      log(db, {
        text: `session ${qemu.id}: stopped; ${finalStatus}${reason === undefined ? "" : `; ${reason}`}`,
        sessionId: qemu.id,
        agentId: agent,
      });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/send-keys", Effect.gen(function* () {
      const started = Date.now();
      const { id, keys, encoding, agent } = yield* jsonBody(SendKeysBody);
      const live = yield* session(id, agent);
      const qemu = live.qemu;
      const chords = yield* Effect.try({
        try: () => parseKeys(keys, encoding),
        catch: (err) => badRequest((err as Error).message, { sessionId: qemu.id, agentId: agent }),
      });
      if (chords.length > MAX_KEYS) {
        return yield* Effect.fail(badRequest(`send-keys: at most ${MAX_KEYS} keys per request`, { sessionId: qemu.id, agentId: agent }));
      }
      const record = recorder(live);
      yield* Effect.tryPromise({
        try: () => sendKeys(qemu, chords, record),
        catch: (err) => exchangeFailed(err, { sessionId: qemu.id, agentId: agent }),
      });
      log(db, { text: `session ${qemu.id}: sent ${chords.length} chords in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/send-mouse", Effect.gen(function* () {
      const started = Date.now();
      const { id, x, y, button, clicks, agent } = yield* jsonBody(SendMouseBody);
      const live = yield* session(id, agent);
      const qemu = live.qemu;
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
        return yield* Effect.fail(badRequest("mouse: x and y must be in 0..1", { sessionId: qemu.id, agentId: agent }));
      }
      if (clicks !== undefined && (!Number.isInteger(clicks) || clicks < 1 || clicks > MAX_CLICKS)) {
        return yield* Effect.fail(badRequest(`mouse: clicks must be an integer in 1..${MAX_CLICKS}`, { sessionId: qemu.id, agentId: agent }));
      }
      yield* Effect.tryPromise({
        try: () => sendMouse(qemu, x, y, button, clicks, recorder(live)),
        catch: (err) => exchangeFailed(err, { sessionId: qemu.id, agentId: agent }),
      });
      log(db, {
        text: `session ${qemu.id}: mouse ${x} ${y}${button === undefined ? "" : ` ${button}${clicks === undefined || clicks === 1 ? "" : ` ×${clicks}`}`} in ${Date.now() - started}ms`,
        sessionId: qemu.id,
        agentId: agent,
      });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/intent/start", Effect.gen(function* () {
      const { id, agent, test_result_id, message } = yield* jsonBody(IntentStartBody);
      const live = yield* session(id, agent);
      if (live.intent !== undefined) {
        return yield* Effect.fail(failed(
          "Cannot start one intent when one's already running. Please end your previous intent.",
          { sessionId: live.qemu.id, agentId: agent },
        ));
      }
      live.intent = startIntentSpan(live.span, live.qemu.id, agent, test_result_id, message);
      log(db, { text: `session ${live.qemu.id}: intent start; ${message}`, sessionId: live.qemu.id, agentId: agent });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/intent/end", Effect.gen(function* () {
      const { id, agent } = yield* jsonBody(IntentEndBody);
      const live = yield* session(id, agent);
      if (live.intent === undefined) {
        return yield* Effect.fail(badRequest("no active intent", { sessionId: live.qemu.id, agentId: agent }));
      }
      finishOpenIntent(live, "completed");
      log(db, { text: `session ${live.qemu.id}: intent end`, sessionId: live.qemu.id, agentId: agent });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("*", "*", HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 }));
  })
);

function errorBody(status: number, message: string): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status });
}

function answer(
  request: HttpServerRequest.HttpServerRequest,
  status: number,
  message: string,
  who: { sessionId?: string; agentId?: string; cause?: unknown },
  detail = message,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.sync(() => {
    log(
      db,
      {
        level: "error",
        text: `${request.method} ${request.originalUrl} failed: ${detail}`,
        sessionId: who.sessionId,
        agentId: who.agentId,
      },
      status < 500 ? { skipSentry: true } : { cause: who.cause },
    );
    return errorBody(status, message);
  });
}

// Total over ApiError's tags: dropping an arm, or adding a tag without one, does not compile.
function respondTable(request: HttpServerRequest.HttpServerRequest): {
  readonly [K in ApiError["_tag"]]: (err: Extract<ApiError, { _tag: K }>) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
} {
  return {
    BadRequest: (err) => answer(request, 400, err.message, err),
    Failed: (err) => answer(request, 500, err.message, err),
    Forbidden: (err) => answer(request, 403, err.message, err),
    UnknownSession: (err) =>
      answer(request, 404, `unknown session "${err.id}"`, {
        // logs.session_id is a uuid column: attribute ids this server could have
        // minted, drop the attribution for garbage.
        sessionId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(err.id) ? err.id : undefined,
        agentId: err.agentId,
      }),
    StartFailed: (err) => answer(request, 502, err.message, err),
    ExchangeFailed: (err) => answer(request, 502, err.message, err),
    Internal: (err) => answer(request, 500, "internal error", err, errorDetail(err.cause)),
  };
}

const respond = HttpRouter.middleware<{ handles: ApiError }>()((handler) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      return answer(request, 401, "unauthorized", {});
    }
    return handler.pipe(
      Effect.catchTags(respondTable(request)),
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          log(
            db,
            {
              level: "error",
              text: `${request.method} ${request.originalUrl} failed: ${defect instanceof Error ? defect.stack ?? defect.message : String(defect)}`,
            },
            { cause: defect },
          );
          return errorBody(500, "internal error");
        })
      ),
    );
  }), { global: true });

async function stopTimedOutSessions(): Promise<void> {
  const now = Date.now();
  const timedOut = [...sessions.values()].filter((live) => now - live.lastCommandAt >= SESSION_TIMEOUT_MS);
  for (const live of timedOut) {
    sessions.delete(live.qemu.id);
  }
  const results = await Promise.allSettled(
    timedOut.map(async (live) => {
      const { qemu } = live;
      try {
        await stop(qemu);
      } catch (err) {
        // stop() already destroyed the socket and signaled QEMU, so still close the record.
        log(db, { level: "error", text: `session ${qemu.id}: timeout cleanup failed: ${errorDetail(err)}`, sessionId: qemu.id }, { cause: err });
      }
      try {
        await endSession(db, qemu.id, "timed_out", SESSION_TIMEOUT_REASON);
        log(db, { text: `session ${qemu.id}: timed out; ${SESSION_TIMEOUT_REASON}`, sessionId: qemu.id });
      } finally {
        finishLiveSession(live, "timed_out");
      }
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      log(db, {
        level: "error",
        text: `session ${timedOut[i].qemu.id}: recording timeout failed: ${errorDetail(result.reason)}`,
        sessionId: timedOut[i].qemu.id,
      }, { cause: result.reason });
    }
  }
}

let timeoutCleanup: Promise<void> = Promise.resolve();
let timeoutCleanupRunning = false;
const sessionTimeoutTimer = setInterval(() => {
  if (timeoutCleanupRunning) {
    return;
  }
  timeoutCleanupRunning = true;
  timeoutCleanup = stopTimedOutSessions()
    .catch((err: unknown) => {
      log(db, { level: "error", text: `session timeout cleanup failed: ${errorDetail(err)}` }, { cause: err });
    })
    .finally(() => {
      timeoutCleanupRunning = false;
    });
}, SESSION_TIMEOUT_CHECK_MS);
sessionTimeoutTimer.unref();

let shutdownFailed = false;
const drainSessions = Layer.effectDiscard(
  Effect.addFinalizer(() =>
    Effect.promise(async () => {
      clearInterval(sessionTimeoutTimer);
      await timeoutCleanup;
      log(db, `proxy: shutting down; stopping ${sessions.size} sessions`);
      const results = await Promise.allSettled(
        [...sessions.values()].map(async (live) => {
          const { qemu } = live;
          let status: SessionEndStatus = "failed";
          try {
            await stop(qemu);
            status = "aborted";
            await endSession(db, qemu.id, "aborted", "proxy shutdown");
            log(db, { text: `session ${qemu.id}: stopped; aborted; proxy shutdown`, sessionId: qemu.id });
          } catch (err) {
            log(db, { level: "error", text: `shutdown: session ${qemu.id}: ${(err as Error).message}`, sessionId: qemu.id }, { cause: err });
            throw err;
          } finally {
            finishLiveSession(live, status);
          }
        }),
      );
      shutdownFailed = results.some((result) => result.status === "rejected");
    })
  ),
);

// The platform drops its error listener once the server is up; a later server error
// (the acceptor breaking) still needs the fatal line, the flush, and exit 1.
const server = createServer();
let serverFailing = false;
const main = (display: QemuDisplay, automation: boolean, port: number) => Layer.effectDiscard(
  Effect.sync(() => {
    log(db, `oligarchy proxy listening on ${DEFAULT_HOST}:${port}; display ${display}${automation ? "; automation" : ""}`);
    server.on("error", (err) => {
      // Later accept errors must not exit before the first fatal flush finishes.
      if (serverFailing) {
        return;
      }
      serverFailing = true;
      log(db, { level: "fatal", text: `proxy: ${err.message}` }, { cause: err });
      clearInterval(sessionTimeoutTimer);
      const open = [...openSessions];
      openSessions.clear();
      sessions.clear();
      // The acceptor is gone, not the database: still close each open session's row
      // so a proxy crash does not leave sessions stuck 'running' forever.
      const cleanup = open.map(async (live) => {
        try {
          await stop(live.qemu);
        } catch {
          // already going down; the row close below is what matters
        }
        try {
          await endSession(db, live.qemu.id, "aborted", `proxy error: ${err.message}`);
        } catch (e) {
          log(db, { level: "error", text: `shutdown: session ${live.qemu.id}: ${errorDetail(e)}`, sessionId: live.qemu.id }, { cause: e });
        }
        finishLiveSession(live, "aborted");
      });
      void Promise.allSettled(cleanup).then(flushLogs).then(flushSentry).then(() => process.exit(1));
    });
  }),
).pipe(
  Layer.provide(HttpRouter.serve(Layer.mergeAll(routes(display, automation), respond, drainSessions), { disableLogger: true, disableListenLog: true })),
  Layer.provide(NodeHttpServer.layer(() => server, { host: DEFAULT_HOST, port })),
);

const proxy = Command.make(
  "proxy",
  {
    display: Flag.choice("display", QEMU_DISPLAYS).pipe(
      Flag.optional,
      Flag.withDescription("QEMU display backend for every session; none captures without showing a window"),
    ),
    automation: Flag.boolean("automation").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Force the automation QEMU profile for every session"),
    ),
    port: Flag.integer("port").pipe(
      Flag.withDefault(DEFAULT_PORT),
      Flag.withDescription("Listen port"),
    ),
  },
  ({ display, automation, port }) => {
    if (automation && Option.isSome(display)) {
      return Effect.fail(new CliError.UserError({
        cause: new Error("--automation is exclusive"),
        userMessage: "--automation is exclusive",
      }));
    }
    const resolved: QemuDisplay = Option.getOrElse(display, () => "none");
    return Effect.gen(function* () {
      const missing = yield* Effect.promise(() => missingHostRequirements(resolved));
      if (missing.length > 0) {
        return yield* Effect.fail(new Error(`missing host requirements:\n${missing.join("\n")}`));
      }
      // Fail at startup, not on the first request, if the control-plane DB is unreachable.
      yield* Effect.tryPromise({
        try: () => pingDatabase(db),
        catch: (cause) => new Error(`database unreachable: ${errorDetail(cause)}`),
      });
      return yield* Layer.launch(main(resolved, automation, port));
    }).pipe(
      Effect.tapError((err) => Effect.sync(() => log(db, { level: "fatal", text: `proxy: ${errorDetail(err)}` }, { cause: err }))),
    );
  },
).pipe(Command.withDescription("The oligarchy proxy: boots QEMU sessions and drives them over QMP"));

NodeRuntime.runMain(
  proxy.pipe(
    Command.run({ version: "0.0.0" }),
    Effect.provide(NodeServices.layer),
  ),
  {
    disableErrorReporting: true,
    teardown: (exit, onExit) => {
      void flushLogs().then(flushSentry).then(() => {
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
          return onExit(1);
        }
        onExit(shutdownFailed ? 1 : 0);
      });
    },
  },
);
