// The oligarchy proxy: a main file, not a library. It serves an HTTP control
// plane that boots QEMU sessions and drives them by session uuid.
//
//   node --experimental-strip-types src/qemu/proxy.ts <iso>
//
// The default iso comes from argv or OLIGARCHY_ISO; the listen address from
// OLIGARCHY_ADDR (default 127.0.0.1:42069). The control-plane database comes
// from DATABASE_URL — a proxy that cannot record its sessions refuses to
// boot, and every session, QMP exchange, image, and iso event is recorded
// as it happens (see field-guide/database.md).
//
//   POST /start      -> {"iso"?, "disk"?, "agent"?}; boots a qemu, returns
//                       {"id": uuid}; an http(s) iso is downloaded into
//                       ~/.oligarchy/isos once (a start that finds a running
//                       download waits for it) and reused from there on
//                       later starts
//   GET  /image?id=&agent= -> PNG of that session's guest display
//   GET  /stats      -> qemu count + host memory + cpu percentiles (last 5m)
//   POST /send-keys  -> {"id", "keys": "Hi<ENTER>", "encoding"?, "agent"?}
//   POST /stop       -> {"id", "status"?, "reason"?}; kills the qemu, removes
//                       its session dir, and records the verdict (default
//                       aborted)
//
// The HTTP layer is Effect (v4). Each route is an Effect whose error type
// names the operational errors it can answer with — the ApiError union
// below — and the respond middleware is the one place that turns each tag
// into the wire shape {"error": message}. The compiler closes the loop: a
// route cannot fail with anything outside the union, and the middleware
// cannot omit a tag. Anything else that goes wrong is a defect — a bug —
// logged in full on stderr and shown to the client only as a generic 500.
// The subsystems the routes call (the qemu client, the iso cache, the db
// ops) are still promise code, untouched by this spike; their failures are
// mapped into the coarser tags at each call site, and sharpen into precise
// ones only when those files move to Effect themselves.

import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
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

// One action row per QMP exchange: opened as the command goes out, closed
// with the outcome when the reply lands (see database.md).
function recorder(sessionId: string, agentId: string | undefined): QemuExchangeRecorder {
  return async (command) => {
    const id = await startAction(db, { sessionId, agentId, request: command });
    return async (outcome) => {
      await finishAction(db, id, outcome);
    };
  };
}

// Every operational error a route can answer with, as plain tagged values
// (no classes — AGENTS.md). BadRequest and UnknownSession are the client's
// mistakes and carry their message onto the wire; BootFailed and
// ExchangeFailed are operations that genuinely failed and whose message is
// exactly what the driving agent needs to read; Internal is ours — the
// cause is logged here and the client learns nothing but "internal error".
type ApiError =
  | { readonly _tag: "BadRequest"; readonly message: string }
  | { readonly _tag: "UnknownSession"; readonly id: string }
  | { readonly _tag: "BootFailed"; readonly message: string }
  | { readonly _tag: "ExchangeFailed"; readonly message: string }
  | { readonly _tag: "Internal"; readonly cause: unknown };

function badRequest(message: string): ApiError {
  return { _tag: "BadRequest", message };
}

// The cast is the same contract the rest of the repo leans on: everything
// the wrapped subsystems throw is an Error.
function bootFailed(err: unknown): ApiError {
  return { _tag: "BootFailed", message: (err as Error).message };
}

function exchangeFailed(err: unknown): ApiError {
  return { _tag: "ExchangeFailed", message: (err as Error).message };
}

function internal(cause: unknown): ApiError {
  return { _tag: "Internal", cause };
}

function session(id: string | undefined): Effect.Effect<Qemu, ApiError> {
  if (id === undefined || id === "") {
    return Effect.fail(badRequest("session id is required"));
  }
  const qemu = sessions.get(id);
  if (qemu === undefined) {
    return Effect.fail({ _tag: "UnknownSession", id });
  }
  return Effect.succeed(qemu);
}

// The request body as text. A failed read is the request's problem (the
// client hung up mid-body), answered like any other bad request.
const bodyText: Effect.Effect<string, ApiError, HttpServerRequest.HttpServerRequest> = Effect.flatMap(
  HttpServerRequest.HttpServerRequest,
  (request) => Effect.mapError(request.text, (err) => badRequest(err.message)),
);

// A repeated query param arrives parsed as an array; the first value is
// the one url.searchParams.get() answered with before.
function first(value: string | ReadonlyArray<string> | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

// The boot work behind /start — still promise code end to end, because the
// qemu client, iso cache, and db ops are out of this spike's scope.
async function boot(qemu: Qemu, cfg: { disk?: string; agent?: string }, isoName: string, isUrl: boolean): Promise<void> {
  try {
    // Inside the try: a rejected registration (the agent already drives
    // a session) must close this session as failed, not leave it open.
    if (cfg.agent !== undefined) {
      await registerAgent(db, cfg.agent, qemu.id);
    }
    const iso = await getIso(db, isoName, { sessionId: qemu.id, agentId: cfg.agent });
    if (cfg.disk === undefined) {
      await createDisk(qemu);
    } else {
      // start() puts the firmware copy and the QMP socket in the session
      // dir; with a caller-provided disk, createDisk never made it.
      await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
    }
    await start(qemu, { iso, disk: cfg.disk }, recorder(qemu.id, cfg.agent));
    if (isUrl) {
      await sessionRunning(db, qemu.id);
    }
  } catch (err) {
    // The qemu must not outlive its failed start — a machine the map
    // never held would be unreachable and unkillable through the API.
    // The boot error is the one worth seeing if cleanup fails too.
    await stop(qemu).catch(() => {});
    await endSession(db, qemu.id, "failed", (err as Error).message).catch((e: unknown) => {
      console.error(`db: recording a failed start failed too: ${(e as Error).message}`);
    });
    throw err;
  }
}

const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("POST", "/start", Effect.gen(function* () {
      const raw = yield* bodyText;
      const cfg = raw === ""
        ? {}
        : yield* Effect.try({
          try: () => JSON.parse(raw) as { iso?: string; disk?: string; agent?: string },
          catch: (err) => badRequest((err as Error).message),
        });
      const isoName = cfg.iso ?? defaultIso;
      const isUrl = isoName.startsWith("http://") || isoName.startsWith("https://");
      const qemu = createQemu();
      // The session row exists before any boot work, so iso events have a
      // session to hang on: a url iso enters as "downloading", a local path
      // goes straight to "running".
      yield* Effect.tryPromise({
        try: () => insertSession(db, qemu.id, { iso: isoName, disk: cfg.disk }, isUrl ? "downloading" : "running"),
        catch: internal,
      });
      yield* Effect.tryPromise({
        try: () => boot(qemu, cfg, isoName, isUrl),
        catch: bootFailed,
      });
      sessions.set(qemu.id, qemu);
      return HttpServerResponse.jsonUnsafe({ id: qemu.id });
    }));

    yield* router.add("GET", "/image", Effect.gen(function* () {
      const search = yield* HttpServerRequest.ParsedSearchParams;
      const qemu = yield* session(first(search.id));
      const agent = first(search.agent);
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
          catch: exchangeFailed,
        }).pipe(
          // Only a failed exchange is closed without an image. A completed
          // one whose image write failed stays open — the row state
          // database.md documents as a completion that was never persisted;
          // closing it imageless would break the 1:1 promise instead.
          Effect.tapError(() =>
            Effect.promise(async () => {
              if (opened !== undefined && outcome !== undefined && outcome.state === "failed") {
                await finishAction(db, opened, outcome).catch((e: unknown) => {
                  console.error(`db: recording a failed screendump failed too: ${(e as Error).message}`);
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
          catch: internal,
        });
        return HttpServerResponse.uint8Array(data, { contentType: "image/png" });
      });
      return yield* Effect.ensuring(png, Effect.promise(() => rm(path, { force: true })));
    }));

    yield* router.add("GET", "/stats", Effect.sync(() => HttpServerResponse.jsonUnsafe(collectStats(cpuSampler, sessions.size))));

    yield* router.add("POST", "/stop", Effect.gen(function* () {
      const raw = yield* bodyText;
      const { id, status, reason } = yield* Effect.try({
        try: () => JSON.parse(raw) as { id?: string; status?: "succeeded" | "failed" | "aborted"; reason?: string },
        catch: (err) => badRequest((err as Error).message),
      });
      // The verdict is checked before the machine dies: a bad status must
      // not kill the qemu and then fail to record the end.
      if (status !== undefined && status !== "succeeded" && status !== "failed" && status !== "aborted") {
        yield* Effect.fail(badRequest(`unknown status "${status as string}"`));
      }
      const qemu = yield* session(id);
      sessions.delete(qemu.id);
      yield* Effect.tryPromise({ try: () => stop(qemu), catch: internal });
      // The stop ends the session; a stop without a verdict is an abort.
      yield* Effect.tryPromise({ try: () => endSession(db, qemu.id, status ?? "aborted", reason ?? null), catch: internal });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }));

    yield* router.add("POST", "/send-keys", Effect.gen(function* () {
      const raw = yield* bodyText;
      const { id, keys, encoding, agent } = yield* Effect.try({
        try: () => JSON.parse(raw) as { id?: string; keys: string; encoding?: string; agent?: string },
        catch: (err) => badRequest((err as Error).message),
      });
      const qemu = yield* session(id);
      // parseKeys throws only on bad input, so every failure is the client's.
      const chords = yield* Effect.try({
        try: () => parseKeys(keys, encoding),
        catch: (err) => badRequest((err as Error).message),
      });
      const record = recorder(qemu.id, agent);
      yield* Effect.tryPromise({
        try: async () => {
          for (const chord of chords) {
            await sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })), record);
          }
        },
        catch: exchangeFailed,
      });
      return HttpServerResponse.jsonUnsafe({ ok: "true" });
    }));

    // The proxy's own 404, kept as JSON like every other reply.
    yield* router.add("*", "*", HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 }));
  })
);

function errorBody(status: number, message: string): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status });
}

// Every operational error, said once: this table is the whole client-facing
// error contract, and dropping a tag from it (or adding one to ApiError
// without a row here) does not compile. Defects — bugs, never part of any
// route's type — stay off the wire: the full cause goes to stderr and the
// client sees a generic 500. When Sentry arrives, its captureException
// belongs in the Internal and defect arms below and nowhere else.
const respond = HttpRouter.middleware<{ handles: ApiError }>()((handler) =>
  handler.pipe(
    Effect.catchTags({
      BadRequest: (err) => Effect.succeed(errorBody(400, err.message)),
      UnknownSession: (err) => Effect.succeed(errorBody(404, `unknown session "${err.id}"`)),
      BootFailed: (err) => Effect.succeed(errorBody(502, err.message)),
      ExchangeFailed: (err) => Effect.succeed(errorBody(502, err.message)),
      Internal: (err) => Effect.as(Effect.logError("request failed", err.cause), errorBody(500, "internal error")),
    }),
    Effect.catchDefect((defect) => Effect.as(Effect.logError("request handler defect", defect), errorBody(500, "internal error"))),
  ), { global: true });

// Settled, not raced: one session failing to stop or record must not cut
// short the cleanup of the others. The finalizer runs when the server's
// scope closes — a SIGINT/SIGTERM interrupts runMain's fiber and every
// still-running session is stopped and recorded as aborted, like before.
let shutdownFailed = false;
const drainSessions = Layer.effectDiscard(
  Effect.addFinalizer(() =>
    Effect.promise(async () => {
      const results = await Promise.allSettled(
        [...sessions.values()].map(async (qemu) => {
          await stop(qemu);
          await endSession(db, qemu.id, "aborted", "proxy shutdown");
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(`shutdown: ${(result.reason as Error).message}`);
          shutdownFailed = true;
        }
      }
    })
  ),
);

// serve's built-in request logger and listen line are off: the proxy keeps
// its stderr contract — one boot line, error lines only.
const main = Layer.effectDiscard(Effect.sync(() => console.error(`oligarchy proxy listening on ${addr}`))).pipe(
  Layer.provide(HttpRouter.serve(Layer.mergeAll(routes, respond, drainSessions), { disableLogger: true, disableListenLog: true })),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { host, port: Number(port) })),
);

// The exit contract is unchanged: a clean shutdown (signals included) exits
// 0, a session whose cleanup failed makes it 1, and a server that could not
// boot is a plain failure.
NodeRuntime.runMain(Layer.launch(main), {
  teardown: (exit, onExit) => {
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      return onExit(1);
    }
    onExit(shutdownFailed ? 1 : 0);
  },
});
