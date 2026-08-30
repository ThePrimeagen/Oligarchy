// The oligarchy proxy: a main file, not a library. It serves an HTTP control
// plane that boots QEMU sessions and drives them by session uuid.
//
//   node --experimental-strip-types src/qemu/proxy.ts <iso>
//
// The default iso comes from argv or OLIGARCHY_ISO; the listen address from
// OLIGARCHY_ADDR (default 127.0.0.1:42069). The control-plane database comes
// from DATABASE_URL — a proxy that cannot record its sessions refuses to
// boot, and every session, QMP exchange, image, and iso event is recorded
// as it happens. Major actions also land in the logs table through log():
// the lifecycle at info with how long each took, failed requests at error,
// the death of the proxy at fatal (see field-guide/database.md).
//
//   POST /start      -> {"iso"?, "disk"?, "agent"}; boots a qemu, returns
//                       {"id": uuid}; an http(s) iso is downloaded into
//                       ~/.oligarchy/isos once (a start that finds a running
//                       download waits for it) and reused from there on
//                       later starts
//   GET  /image?id=&agent= -> PNG of that session's guest display
//   GET  /stats      -> qemu count + host memory + cpu percentiles (last 5m)
//   POST /send-keys  -> {"id", "keys": "Hi<ENTER>", "encoding"?, "agent"}
//   POST /stop       -> {"id", "status"?, "reason"?}; kills the qemu, removes
//                       its session dir, and records the verdict (default
//                       aborted)
//
// The HTTP layer is Effect (v4). Request shapes are Schema structs decoded
// at the boundary — the one place input is validated — and the agent id is
// required on every session-driving request. Each route is an Effect whose
// error type names the operational errors it can answer with — the
// ApiError union below — and the respond middleware is the one place that
// turns each tag into the wire shape {"error": message}. The compiler
// closes the loop: a route cannot fail with anything outside the union,
// and the middleware cannot omit a tag. Anything else that goes wrong is a
// defect — a bug — logged in full on stderr and shown to the client only
// as a generic 500.
// The subsystems the routes call (the qemu client, the iso cache, the db
// ops) are still promise code, untouched by this spike; their failures are
// mapped into the coarser tags at each call site, and sharpen into precise
// ones only when those files move to Effect themselves.

import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { flushLogs, log } from "../db/log.ts";
import { connectDatabase, endSession, finishAction, insertSession, registerAgent, sessionRunning, startAction } from "../db/ops.ts";
import { createDisk, createQemu, screendump, sendKey, start, stop, type Qemu } from "./client.ts";
import { getIso } from "./iso.ts";
import { parseKeys } from "./keys.ts";
import { collectStats, startCpuSampler } from "./stats.ts";

const defaultIso = process.argv[2] ?? process.env.OLIGARCHY_ISO;
if (defaultIso === undefined) {
  console.error("usage: proxy <iso>  (or set OLIGARCHY_ISO)");
  process.exit(1);
}
const addr = process.env.OLIGARCHY_ADDR ?? "127.0.0.1:42069";
const [host, port] = addr.split(":");

// A control plane that cannot record its sessions must not boot.
const db = connectDatabase();

const sessions = new Map<string, Qemu>();
const cpuSampler = startCpuSampler();

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own
// message is the failed SQL and the params — noise in a log line.
function errorDetail(err: unknown): string {
  const e = err as Error;
  return e.cause instanceof Error ? e.cause.message : e.message;
}

// One action row per QMP exchange: opened as the command goes out, closed
// with the outcome when the reply lands (see database.md). A close that
// cannot be recorded is logged against its session before it surfaces —
// the open row it leaves behind is the state database.md documents, and
// the caller (client.ts) still decides whether the failure is swallowed
// (after a failed exchange) or surfaced (after a completed one).
function recorder(sessionId: string, agentId: string): QemuExchangeRecorder {
  return async (command) => {
    const id = await startAction(db, { sessionId, agentId, request: command });
    return async (outcome) => {
      try {
        await finishAction(db, id, outcome);
      } catch (err) {
        log(db, { level: "error", text: `db: closing action ${id} failed: ${errorDetail(err)}`, sessionId, agentId });
        throw err;
      }
    };
  };
}

// Every operational error a route can answer with, as plain tagged values
// (no classes — AGENTS.md). BadRequest and UnknownSession are the client's
// mistakes and carry their message onto the wire; StartFailed and
// ExchangeFailed are operations that genuinely failed and whose message is
// exactly what the driving agent needs to read; Internal is ours — the
// cause is logged and the client learns nothing but "internal error".
// Every tag carries the session and agent as far as its route knew them,
// so the respond middleware's one error line per failed request lands
// where a session inspection will find it.
type ApiError =
  | { readonly _tag: "BadRequest"; readonly message: string; readonly sessionId?: string; readonly agentId?: string }
  | { readonly _tag: "UnknownSession"; readonly id: string; readonly agentId?: string }
  | { readonly _tag: "StartFailed"; readonly message: string; readonly sessionId: string; readonly agentId: string }
  | { readonly _tag: "ExchangeFailed"; readonly message: string; readonly sessionId: string; readonly agentId: string }
  | { readonly _tag: "Internal"; readonly cause: unknown; readonly sessionId: string; readonly agentId?: string };

function badRequest(message: string, who: { sessionId?: string; agentId?: string } = {}): ApiError {
  return { _tag: "BadRequest", message, ...who };
}

// The cast is the same contract the rest of the repo leans on: everything
// the wrapped subsystems throw is an Error.
function startFailed(err: unknown, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "StartFailed", message: (err as Error).message, ...who };
}

function exchangeFailed(err: unknown, who: { sessionId: string; agentId: string }): ApiError {
  return { _tag: "ExchangeFailed", message: (err as Error).message, ...who };
}

function internal(cause: unknown, who: { sessionId: string; agentId?: string }): ApiError {
  return { _tag: "Internal", cause, ...who };
}

function session(id: string, agentId?: string): Effect.Effect<Qemu, ApiError> {
  if (id === "") {
    return Effect.fail(badRequest("session id is required", { agentId }));
  }
  const qemu = sessions.get(id);
  if (qemu === undefined) {
    return Effect.fail({ _tag: "UnknownSession", id, agentId });
  }
  return Effect.succeed(qemu);
}

// What each request must say, stated once as schemas: the schema is the
// accepted input, and a request that does not match it is answered with
// the decode error's own words. agent is required on every session-driving
// request — this control plane is driven by agents, and a request that
// names no agent has no business being sent (the CLI already refuses to).
// The wire key is "agent"; its value is the agent's id, which the code and
// the database call agentId — one value, two spellings. /stop stays
// agentless by design: a stop exchanges nothing over QMP and is not an
// action, it carries the session's verdict instead.
const StartBody = Schema.Struct({
  iso: Schema.optionalKey(Schema.String),
  disk: Schema.optionalKey(Schema.String),
  // Non-empty like the CLI's own --agent-id check: "" is not an agent.
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

// The verdict rides the shape: a bad status never reaches the handler, so
// it cannot kill the qemu and then fail to record the end.
const StopBody = Schema.Struct({
  id: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["succeeded", "failed", "aborted"])),
  reason: Schema.optionalKey(Schema.String),
});

// The one decoded JSON body per POST route. A body that does not read as
// JSON or does not match its schema is the client's mistake — answered
// with JSON.parse's own message (it names the exact spot the body went
// wrong; the platform's request.json hides it) or the decode error's.
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

// The route contract, stated as a type so it is checked, not promised: a
// route answers with a response or fails with an ApiError — nothing else.
// Every handler below carries `satisfies RouteHandler`, so a new failure
// sneaking into a route is a compile error at that route, not a mystery
// 500 at runtime.
type RouteHandler = Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, HttpRouter.Provided>;

// The launch half of /start — still promise code end to end, because the
// qemu client, iso cache, and db ops are out of this spike's scope.
async function launchQemu(qemu: Qemu, cfg: { disk?: string; agent: string }, isoName: string): Promise<void> {
  try {
    // Inside the try: a rejected registration (the agent already drives
    // a session) must close this session as failed, not leave it open.
    await registerAgent(db, cfg.agent, qemu.id);
    const iso = await getIso(db, isoName, { sessionId: qemu.id, agentId: cfg.agent });
    if (cfg.disk === undefined) {
      await createDisk(qemu);
    } else {
      // start() puts the firmware copy and the QMP socket in the session
      // dir; with a caller-provided disk, createDisk never made it.
      await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
    }
    await start(qemu, { iso, disk: cfg.disk }, recorder(qemu.id, cfg.agent));
    // Unconditional: the machine is up, so the row says running — no
    // re-checking how the iso arrived. For a session that entered as
    // "running" this update changes nothing.
    await sessionRunning(db, qemu.id);
  } catch (err) {
    // The qemu must not outlive its failed start — a machine the map
    // never held would be unreachable and unkillable through the API.
    // The start error is the one worth seeing if cleanup fails too.
    await stop(qemu).catch(() => {});
    await endSession(db, qemu.id, "failed", (err as Error).message).catch((e: unknown) => {
      log(db, { level: "error", text: `db: recording a failed start failed too: ${(e as Error).message}`, sessionId: qemu.id, agentId: cfg.agent });
    });
    throw err;
  }
}

// Everything /start does once its body is decoded: create the session
// row, launch the machine, and only then let the sessions map hold it.
// Returns the new session's id; fails with ApiError and nothing else.
// started is the request's clock, ticking since before the body was read.
function startSession(cfg: typeof StartBody.Type, started: number): Effect.Effect<string, ApiError> {
  return Effect.gen(function* () {
    const isoName = cfg.iso ?? defaultIso;
    const isUrl = isoName.startsWith("http://") || isoName.startsWith("https://");
    const qemu = createQemu();
    // The session row exists before any start work, so iso events have a
    // session to hang on: a url iso enters as "downloading", a local path
    // goes straight to "running".
    yield* Effect.tryPromise({
      try: () => insertSession(db, qemu.id, { iso: isoName, disk: cfg.disk }, isUrl ? "downloading" : "running"),
      catch: (cause) => internal(cause, { sessionId: qemu.id, agentId: cfg.agent }),
    });
    log(db, {
      text: `session ${qemu.id}: starting; iso ${isoName}${cfg.disk === undefined ? "" : `, disk ${cfg.disk}`}`,
      sessionId: qemu.id,
      agentId: cfg.agent,
    });
    yield* Effect.tryPromise({
      try: () => launchQemu(qemu, cfg, isoName),
      catch: (err) => startFailed(err, { sessionId: qemu.id, agentId: cfg.agent }),
    });
    sessions.set(qemu.id, qemu);
    // Wall time from request to a live QMP handshake, download included —
    // per-exchange timing lives on the action rows.
    log(db, { text: `session ${qemu.id}: running; started in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: cfg.agent });
    return qemu.id;
  });
}

// The four session-driving routes are uninterruptible: the server
// interrupts a request's fiber when the client disconnects, and a state
// transition must not be torn in half by a vanished client — a booted
// machine the map never received would be unreachable and unkillable, a
// killed machine could go unrecorded. The old handler always ran to
// completion; these keep doing so, and only the reply is lost.
const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("POST", "/start", Effect.gen(function* () {
      const started = Date.now();
      const cfg = yield* jsonBody(StartBody);
      const id = yield* startSession(cfg, started);
      return HttpServerResponse.jsonUnsafe({ id });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("GET", "/image", Effect.gen(function* () {
      const started = Date.now();
      const params = yield* Effect.mapError(HttpRouter.schemaParams(ImageParams), (err) => badRequest(err.message));
      const qemu = yield* session(params.id, params.agent);
      const agent = params.agent;
      const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
      // The PNG is read back only after the exchange closes, and the images
      // row must ride the same transaction that closes the action (they are
      // 1:1) — so the recorder only stashes, and the route closes.
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
          // Only a failed exchange is closed without an image. A completed
          // one whose image write failed stays open — the row state
          // database.md documents as a completion that was never persisted;
          // closing it imageless would break the 1:1 promise instead.
          Effect.tapError(() =>
            Effect.promise(async () => {
              if (opened !== undefined && outcome !== undefined && outcome.state === "failed") {
                await finishAction(db, opened, outcome).catch((e: unknown) => {
                  log(db, { level: "error", text: `db: recording a failed screendump failed too: ${(e as Error).message}`, sessionId: qemu.id, agentId: agent });
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

    yield* router.add("GET", "/stats", Effect.sync(() => HttpServerResponse.jsonUnsafe(collectStats(cpuSampler, sessions.size))) satisfies RouteHandler);

    yield* router.add("POST", "/stop", Effect.gen(function* () {
      const { id, status, reason } = yield* jsonBody(StopBody);
      const qemu = yield* session(id);
      sessions.delete(qemu.id);
      yield* Effect.tryPromise({ try: () => stop(qemu), catch: (cause) => internal(cause, { sessionId: qemu.id }) });
      // The stop ends the session; a stop without a verdict is an abort.
      yield* Effect.tryPromise({
        try: () => endSession(db, qemu.id, status ?? "aborted", reason ?? null),
        catch: (cause) => internal(cause, { sessionId: qemu.id }),
      });
      log(db, {
        text: `session ${qemu.id}: stopped; ${status ?? "aborted"}${reason === undefined ? "" : `; ${reason}`}`,
        sessionId: qemu.id,
      });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    yield* router.add("POST", "/send-keys", Effect.gen(function* () {
      const started = Date.now();
      const { id, keys, encoding, agent } = yield* jsonBody(SendKeysBody);
      const qemu = yield* session(id, agent);
      // parseKeys throws only on bad input, so every failure is the
      // client's — attributed, so the refused key string lands in the
      // session's story beside the actions it never became.
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
      // The request-level story; each chord is its own action row with its
      // own timing.
      log(db, { text: `session ${qemu.id}: sent ${chords.length} chords in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }) satisfies RouteHandler, { uninterruptible: true });

    // The proxy's own 404, kept as JSON like every other reply.
    yield* router.add("*", "*", HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 }));
  })
);

function errorBody(status: number, message: string): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status });
}

// One error line per failed request — method, url, and what went wrong —
// attributed as far as the route knew, then the wire answer. The log line
// and the client's message differ only for Internal: the client gets no
// internals. When Sentry arrives, its captureException belongs here and
// in the defect arm below, nowhere else.
function answer(
  request: HttpServerRequest.HttpServerRequest,
  status: number,
  message: string,
  who: { sessionId?: string; agentId?: string },
  detail = message,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.sync(() => {
    log(db, { level: "error", text: `${request.method} ${request.originalUrl} failed: ${detail}`, ...who });
    return errorBody(status, message);
  });
}

// Every operational error, said once: this table is the whole client-facing
// error contract. Its type is total over ApiError's tags — catchTags alone
// would let an arm silently fall through to the platform's default 500, so
// the table says every tag must have a row, and dropping one (or adding a
// tag to ApiError without one) does not compile.
function respondTable(request: HttpServerRequest.HttpServerRequest): {
  readonly [K in ApiError["_tag"]]: (err: Extract<ApiError, { _tag: K }>) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
} {
  return {
    BadRequest: (err) => answer(request, 400, err.message, err),
    UnknownSession: (err) =>
      answer(request, 404, `unknown session "${err.id}"`, {
        // logs.session_id is a uuid column, and logs has no foreign keys by
        // design — so an id this server could have minted is attributed (an
        // agent still driving a stopped session is history worth keeping),
        // while garbage ids get the line without the attribution.
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
          // A defect is a bug: the stack names the spot, so it rides the
          // line. A defect is also by definition not ours, so the boundary
          // that keeps the process alive assumes nothing about its shape.
          log(db, {
            level: "error",
            text: `${request.method} ${request.originalUrl} failed: ${defect instanceof Error ? defect.stack ?? defect.message : String(defect)}`,
          });
          return errorBody(500, "internal error");
        })
      ),
    )
  ), { global: true });

// Settled, not raced: one session failing to stop or record must not cut
// short the cleanup of the others. The finalizer runs when the server's
// scope closes — a SIGINT/SIGTERM interrupts runMain's fiber and every
// still-running session is stopped and recorded as aborted, like before.
let shutdownFailed = false;
const drainSessions = Layer.effectDiscard(
  Effect.addFinalizer(() =>
    Effect.promise(async () => {
      log(db, `proxy: shutting down; stopping ${sessions.size} sessions`);
      const results = await Promise.allSettled(
        [...sessions.values()].map(async (qemu) => {
          try {
            await stop(qemu);
            await endSession(db, qemu.id, "aborted", "proxy shutdown");
            log(db, { text: `session ${qemu.id}: stopped; aborted; proxy shutdown`, sessionId: qemu.id });
          } catch (err) {
            // Logged here, where the session is known — the sessions that
            // fail are the ones whose absence from the story matters most.
            log(db, { level: "error", text: `shutdown: session ${qemu.id}: ${(err as Error).message}`, sessionId: qemu.id });
            throw err;
          }
        }),
      );
      shutdownFailed = results.some((result) => result.status === "rejected");
    })
  ),
);

// serve's built-in request logger and listen line are off: the proxy keeps
// its stderr contract — one boot line, error lines only. The boot line
// goes through log() too: a proxy restart in the record explains sessions
// that ended as "aborted, proxy shutdown".
const main = Layer.effectDiscard(Effect.sync(() => log(db, `oligarchy proxy listening on ${addr}`))).pipe(
  Layer.provide(HttpRouter.serve(Layer.mergeAll(routes, respond, drainSessions), { disableLogger: true, disableListenLog: true })),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { host, port: Number(port) })),
);

// The exit contract is unchanged: a clean shutdown (signals included) exits
// 0, a session whose cleanup failed makes it 1, and a server that could not
// come up is a fatal line and exit 1. Every exit path flushes the log chain
// first — the last lines are the ones most worth having when the proxy is
// gone — and runMain's own error report is off: the fatal line is the story.
NodeRuntime.runMain(
  Layer.launch(main).pipe(
    // The platform's ServeError says nothing itself; the reason (the port
    // is taken) is the cause underneath.
    Effect.tapError((err) => Effect.sync(() => log(db, { level: "fatal", text: `proxy: ${errorDetail(err)}` }))),
  ),
  {
    disableErrorReporting: true,
    teardown: (exit, onExit) => {
      void flushLogs().then(() => {
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
          return onExit(1);
        }
        onExit(shutdownFailed ? 1 : 0);
      });
    },
  },
);
