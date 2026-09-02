import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { flushLogs, log } from "../db/log.ts";
import { connectDatabase, endSession, finishAction, insertSession, registerAgent, sessionRunning, startAction } from "../db/ops.ts";
import { flushSentry, initSentry } from "../sentry.ts";
import { QEMU_DISPLAYS, createDisk, createQemu, missingHostRequirements, screendump, sendKey, sendMouse, start, stop, type Qemu, type QemuDisplay } from "./client.ts";
import { getIso } from "./iso.ts";
import { parseKeys } from "./keys.ts";
import { collectStats, startCpuSampler } from "./stats.ts";

loadEnvFile();
initSentry();

const addr = process.env.OLIGARCHY_ADDR ?? "127.0.0.1:42069";
const [host, port] = addr.split(":");
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_CHECK_MS = 10_000;
const SESSION_TIMEOUT_REASON = "no command received for 10 minutes";

const db = connectDatabase();

type LiveSession = {
  qemu: Qemu;
  agent: string;
  lastCommandAt: number;
};

const sessions = new Map<string, LiveSession>();
const cpuSampler = startCpuSampler();

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
function errorDetail(err: unknown): string {
  const e = err as Error;
  return e.cause instanceof Error ? e.cause.message : e.message;
}

function recorder(sessionId: string, agentId: string): QemuExchangeRecorder {
  return async (command) => {
    const id = await startAction(db, { sessionId, agentId, request: command });
    return async (outcome) => {
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
  | { readonly _tag: "Internal"; readonly cause: unknown; readonly sessionId: string; readonly agentId?: string };

function badRequest(message: string, who: { sessionId?: string; agentId?: string } = {}): ApiError {
  return { _tag: "BadRequest", message, ...who };
}

function startFailed(err: unknown, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "StartFailed", message: (err as Error).message, cause: err, ...who };
}

function exchangeFailed(err: unknown, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "ExchangeFailed", message: (err as Error).message, cause: err, ...who };
}

function internal(cause: unknown, who: { sessionId: string; agentId?: string }): ApiError {
  return { _tag: "Internal", cause, ...who };
}

function session(id: string, agentId: string): Effect.Effect<Qemu, ApiError> {
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
  return Effect.succeed(live.qemu);
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

async function launchQemu(qemu: Qemu, cfg: typeof StartBody.Type): Promise<void> {
  try {
    await registerAgent(db, cfg.agent, qemu.id);
    const iso = await getIso(db, cfg.iso, { sessionId: qemu.id, agentId: cfg.agent });
    if (cfg.disk === undefined) {
      await createDisk(qemu);
    } else {
      // start() expects the session dir; with a caller-provided disk, createDisk never made it.
      await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
    }
    await start(qemu, { iso, disk: cfg.disk }, recorder(qemu.id, cfg.agent));
    await sessionRunning(db, qemu.id);
  } catch (err) {
    await stop(qemu).catch(() => {});
    await endSession(db, qemu.id, "failed", (err as Error).message).catch((e: unknown) => {
      log(db, { level: "error", text: `db: recording a failed start failed too: ${(e as Error).message}`, sessionId: qemu.id, agentId: cfg.agent }, { cause: e });
    });
    throw err;
  }
}

function startSession(cfg: typeof StartBody.Type, started: number, display: QemuDisplay, automation: boolean): Effect.Effect<string, ApiError> {
  return Effect.gen(function* () {
    const isUrl = cfg.iso.startsWith("http://") || cfg.iso.startsWith("https://");
    const qemu = createQemu({ display, automation });
    yield* Effect.tryPromise({
      try: () => insertSession(db, qemu.id, { iso: cfg.iso, disk: cfg.disk }, isUrl ? "downloading" : "running"),
      catch: (cause) => internal(cause, { sessionId: qemu.id, agentId: cfg.agent }),
    });
    log(db, {
      text: `session ${qemu.id}: starting; iso ${cfg.iso}${cfg.disk === undefined ? "" : `, disk ${cfg.disk}`}`,
      sessionId: qemu.id,
      agentId: cfg.agent,
    });
    yield* Effect.tryPromise({
      try: () => launchQemu(qemu, cfg),
      catch: (err) => startFailed(err, { sessionId: qemu.id, agentId: cfg.agent }),
    });
    sessions.set(qemu.id, { qemu, agent: cfg.agent, lastCommandAt: Date.now() });
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
      const qemu = yield* session(params.id, params.agent);
      const agent = params.agent;
      const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
      // The images row must ride the same transaction that closes the action (they are
      // 1:1), so the recorder only stashes and the route closes.
      let opened: number | undefined;
      let outcome: QemuExchangeOutcome | undefined;
      const png = Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            screendump(qemu, path, "png", async (command) => {
              opened = await startAction(db, { sessionId: qemu.id, agentId: agent, request: command });
              return async (result) => {
                outcome = result;
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
          catch: (cause) => internal(cause, { sessionId: qemu.id, agentId: agent }),
        });
        log(db, { text: `session ${qemu.id}: image; ${data.length} bytes in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
        return HttpServerResponse.uint8Array(data, { contentType: "image/png" });
      });
      return yield* Effect.ensuring(png, Effect.promise(() => rm(path, { force: true })));
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("GET", "/serial", Effect.gen(function* () {
      const started = Date.now();
      const params = yield* Effect.mapError(HttpRouter.schemaParams(ImageParams), (err) => badRequest(err.message));
      const qemu = yield* session(params.id, params.agent);
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
      const qemu = yield* session(id, agent);
      sessions.delete(qemu.id);
      yield* Effect.tryPromise({ try: () => stop(qemu), catch: (cause) => internal(cause, { sessionId: qemu.id, agentId: agent }) });
      yield* Effect.tryPromise({
        try: () => endSession(db, qemu.id, status ?? "aborted", reason ?? null),
        catch: (cause) => internal(cause, { sessionId: qemu.id, agentId: agent }),
      });
      log(db, {
        text: `session ${qemu.id}: stopped; ${status ?? "aborted"}${reason === undefined ? "" : `; ${reason}`}`,
        sessionId: qemu.id,
        agentId: agent,
      });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/send-keys", Effect.gen(function* () {
      const started = Date.now();
      const { id, keys, encoding, agent } = yield* jsonBody(SendKeysBody);
      const qemu = yield* session(id, agent);
      const chords = yield* Effect.try({
        try: () => parseKeys(keys, encoding),
        catch: (err) => badRequest((err as Error).message, { sessionId: qemu.id, agentId: agent }),
      });
      const record = recorder(qemu.id, agent);
      yield* Effect.tryPromise({
        try: async () => {
          for (const chord of chords) {
            await sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })), record);
          }
        },
        catch: (err) => exchangeFailed(err, { sessionId: qemu.id, agentId: agent }),
      });
      log(db, { text: `session ${qemu.id}: sent ${chords.length} chords in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/send-mouse", Effect.gen(function* () {
      const started = Date.now();
      const { id, x, y, button, clicks, agent } = yield* jsonBody(SendMouseBody);
      const qemu = yield* session(id, agent);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
        return yield* Effect.fail(badRequest("mouse: x and y must be in 0..1", { sessionId: qemu.id, agentId: agent }));
      }
      if (clicks !== undefined && (!Number.isInteger(clicks) || clicks < 1)) {
        return yield* Effect.fail(badRequest("mouse: clicks must be a positive integer", { sessionId: qemu.id, agentId: agent }));
      }
      yield* Effect.tryPromise({
        try: () => sendMouse(qemu, x, y, button, clicks, recorder(qemu.id, agent)),
        catch: (err) => exchangeFailed(err, { sessionId: qemu.id, agentId: agent }),
      });
      log(db, {
        text: `session ${qemu.id}: mouse ${x} ${y}${button === undefined ? "" : ` ${button}${clicks === undefined || clicks === 1 ? "" : ` ×${clicks}`}`} in ${Date.now() - started}ms`,
        sessionId: qemu.id,
        agentId: agent,
      });
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
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    handler.pipe(
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
    )
  ), { global: true });

async function stopTimedOutSessions(): Promise<void> {
  const now = Date.now();
  const timedOut = [...sessions.values()].filter((live) => now - live.lastCommandAt >= SESSION_TIMEOUT_MS);
  for (const live of timedOut) {
    sessions.delete(live.qemu.id);
  }
  const results = await Promise.allSettled(
    timedOut.map(async ({ qemu }) => {
      try {
        await stop(qemu);
      } catch (err) {
        // stop() already destroyed the socket and signaled QEMU, so still close the record.
        log(db, { level: "error", text: `session ${qemu.id}: timeout cleanup failed: ${errorDetail(err)}`, sessionId: qemu.id }, { cause: err });
      }
      await endSession(db, qemu.id, "timed_out", SESSION_TIMEOUT_REASON);
      log(db, { text: `session ${qemu.id}: timed out; ${SESSION_TIMEOUT_REASON}`, sessionId: qemu.id });
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
        [...sessions.values()].map(async ({ qemu }) => {
          try {
            await stop(qemu);
            await endSession(db, qemu.id, "aborted", "proxy shutdown");
            log(db, { text: `session ${qemu.id}: stopped; aborted; proxy shutdown`, sessionId: qemu.id });
          } catch (err) {
            log(db, { level: "error", text: `shutdown: session ${qemu.id}: ${(err as Error).message}`, sessionId: qemu.id }, { cause: err });
            throw err;
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
const main = (display: QemuDisplay, automation: boolean) => Layer.effectDiscard(
  Effect.sync(() => {
    log(db, `oligarchy proxy listening on ${addr}; display ${display}${automation ? "; automation" : ""}`);
    server.on("error", (err) => {
      log(db, { level: "fatal", text: `proxy: ${err.message}` }, { cause: err });
      void flushLogs().then(flushSentry).then(() => process.exit(1));
    });
  }),
).pipe(
  Layer.provide(HttpRouter.serve(Layer.mergeAll(routes(display, automation), respond, drainSessions), { disableLogger: true, disableListenLog: true })),
  Layer.provide(NodeHttpServer.layer(() => server, { host, port: Number(port) })),
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
  },
  ({ display, automation }) => {
    if (automation && Option.isSome(display)) {
      return Effect.fail(new CliError.UserError({
        cause: new Error("--automation is exclusive"),
        userMessage: "--automation is exclusive",
      }));
    }
    const resolved = Option.getOrElse(display, () => "none");
    return Effect.gen(function* () {
      const missing = yield* Effect.promise(() => missingHostRequirements(resolved));
      if (missing.length > 0) {
        const text = `missing host requirements:\n${missing.join("\n")}`;
        console.error(`proxy: ${text}`);
        return yield* Effect.fail(new Error(text));
      }
      return yield* Layer.launch(main(resolved, automation));
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
