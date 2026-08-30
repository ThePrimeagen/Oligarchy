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
// HTTP is Effect 4's HttpRouter (effect/unstable/http) on NodeHttpServer.
// qemu, iso, keys, and db stay Promise/throw code; this file lifts them at
// the edge with tryPromise and turns every failure into {"error": "..."}.
//
//   POST /start      -> {"agent", "iso"?, "disk"?}; boots a qemu, returns
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

import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Cause, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
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

// The HTTP layer's only error: a sentence the client can print. qemu / iso /
// db still throw Error; we lift the message here and never let an unknown
// value become {"error": undefined}.
type OpError = { readonly _tag: "OpError"; readonly message: string };

function errorMessage(err: unknown): string {
  const e = err as Error;
  if (e.cause instanceof Error) {
    return `${e.message}: ${e.cause.message}`;
  }
  if (typeof e.message === "string" && e.message !== "") {
    return e.message;
  }
  return String(err);
}

function opError(err: unknown): OpError {
  return { _tag: "OpError", message: errorMessage(err) };
}

function fromPromise<A>(f: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, OpError> {
  return Effect.tryPromise({ try: f, catch: opError });
}

function fromSync<A>(f: () => A): Effect.Effect<A, OpError> {
  return Effect.try({ try: f, catch: opError });
}

const StartBody = Schema.Struct({
  iso: Schema.optionalKey(Schema.String),
  disk: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
});

const StopBody = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

const SendKeysBody = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  keys: Schema.String,
  encoding: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
});

const ImageQuery = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
});

function readJson<S extends Schema.Top>(schema: S) {
  return Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const raw = yield* req.text.pipe(Effect.mapError(opError));
    const value = raw === "" ? {} : yield* fromSync(() => JSON.parse(raw) as unknown);
    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(opError));
  });
}

function session(id: string | null | undefined): Qemu {
  if (id === undefined || id === null || id === "") {
    throw new Error("session id is required");
  }
  const qemu = sessions.get(id);
  if (qemu === undefined) {
    throw new Error(`unknown session "${id}"`);
  }
  return qemu;
}

const startSession = Effect.gen(function* () {
  const cfg = yield* readJson(StartBody);
  if (cfg.agent === undefined || cfg.agent === "") {
    return yield* Effect.fail(opError(new Error("agent is required")));
  }
  const agent = cfg.agent;
  const isoName = cfg.iso ?? defaultIso;
  const isUrl = isoName.startsWith("http://") || isoName.startsWith("https://");
  const qemu = createQemu();
  // Session + agent are one initialization. The two writes stay separate
  // (no db refactor) but they are not operational errors: if either
  // fails, something is very wrong and the start dies.
  yield* Effect.orDie(
    Effect.tryPromise(() =>
      insertSession(db, qemu.id, { iso: isoName, disk: cfg.disk }, isUrl ? "downloading" : "running").then(() =>
        registerAgent(db, agent, qemu.id),
      ),
    ),
  );
  yield* fromPromise(async () => {
    try {
      const iso = await getIso(db, isoName, { sessionId: qemu.id, agentId: agent });
      if (cfg.disk === undefined) {
        await createDisk(qemu);
      } else {
        // start() puts the firmware copy and the QMP socket in the session
        // dir; with a caller-provided disk, createDisk never made it.
        await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
      }
      await start(qemu, { iso, disk: cfg.disk }, recorder(qemu.id, agent));
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
  });
  sessions.set(qemu.id, qemu);
  return HttpServerResponse.jsonUnsafe({ id: qemu.id });
});

const getImage = Effect.gen(function* () {
  const query = yield* HttpServerRequest.schemaSearchParams(ImageQuery).pipe(Effect.mapError(opError));
  const qemu = yield* fromSync(() => session(query.id));
  const agent = query.agent;
  const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
  // The PNG is read back only after the exchange closes, and the images
  // row must ride the same transaction that closes the action (they are
  // 1:1) — so the recorder only stashes, and the handler closes.
  const data = yield* fromPromise(async () => {
    let opened: number | undefined;
    let outcome: QemuExchangeOutcome | undefined;
    try {
      await screendump(qemu, path, "png", async (command) => {
        opened = await startAction(db, { sessionId: qemu.id, agentId: agent, request: command });
        return async (result) => {
          outcome = result;
        };
      });
      const bytes = await readFile(path);
      // screendump resolved, so the recorder ran: opened and outcome are set.
      await finishAction(db, opened!, outcome!, bytes);
      return bytes;
    } catch (err) {
      // Only a failed exchange is closed without an image. A completed one
      // whose image write failed stays open — the row state database.md
      // documents as a completion that was never persisted; closing it
      // imageless would break the 1:1 promise instead.
      if (opened !== undefined && outcome !== undefined && outcome.state === "failed") {
        await finishAction(db, opened, outcome).catch((e: unknown) => {
          console.error(`db: recording a failed screendump failed too: ${(e as Error).message}`);
        });
      }
      throw err;
    } finally {
      await rm(path, { force: true });
    }
  });
  return HttpServerResponse.uint8Array(data, { contentType: "image/png" });
});

const getStats = Effect.sync(() => HttpServerResponse.jsonUnsafe(collectStats(cpuSampler, sessions.size)));

const stopSession = Effect.gen(function* () {
  const { id, status, reason } = yield* readJson(StopBody);
  // The verdict is checked before the machine dies: a bad status must
  // not kill the qemu and then fail to record the end.
  if (status !== undefined && status !== "succeeded" && status !== "failed" && status !== "aborted") {
    return yield* Effect.fail(opError(new Error(`unknown status "${status}"`)));
  }
  const qemu = yield* fromSync(() => session(id));
  sessions.delete(qemu.id);
  yield* fromPromise(() => stop(qemu));
  // The stop ends the session; a stop without a verdict is an abort.
  yield* fromPromise(() => endSession(db, qemu.id, status ?? "aborted", reason ?? null));
  return HttpServerResponse.jsonUnsafe({ ok: "true" });
});

const sendKeys = Effect.gen(function* () {
  const { id, keys, encoding, agent } = yield* readJson(SendKeysBody);
  const qemu = yield* fromSync(() => session(id));
  const record = recorder(qemu.id, agent);
  const chords = yield* fromSync(() => parseKeys(keys, encoding));
  for (const chord of chords) {
    yield* fromPromise(() => sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })), record));
  }
  return HttpServerResponse.jsonUnsafe({ ok: "true" });
});

function clientResponse(err: unknown, status: number): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe({ error: errorMessage(err) }, { status });
}

function fromCause<E>(cause: Cause.Cause<E>): HttpServerResponse.HttpServerResponse {
  const failed = Option.getOrUndefined(Cause.findErrorOption(cause));
  if (failed !== undefined) {
    return clientResponse(failed, errorMessage(failed) === "not found" ? 404 : 400);
  }
  // Die: session init, or anything else that is not an operational fail.
  return clientResponse(Cause.squash(cause), 500);
}

// Handler errors become the {"error": "..."} the CLI already prints.
// HttpRouter's catch-all for unknown paths is a miss, so that route says
// "not found" itself — Effect's RouteNotFound would be an empty 404.
function asHttp<E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catchCause(effect, (cause) => Effect.succeed(fromCause(cause)));
}

// Settled, not raced: one session failing to stop or record must not
// cut short the cleanup of the others. NodeRuntime.runMain interrupts
// this scope on SIGINT/SIGTERM.
const Shutdown = Layer.effectDiscard(
  Effect.gen(function* () {
    console.error(`oligarchy proxy listening on ${addr}`);
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        Promise.allSettled(
          [...sessions.values()].map(async (qemu) => {
            await stop(qemu);
            await endSession(db, qemu.id, "aborted", "proxy shutdown");
          }),
        ).then((results) => {
          for (const result of results) {
            if (result.status === "rejected") {
              console.error(`shutdown: ${(result.reason as Error).message}`);
            }
          }
        }),
      ),
    );
  }),
);

const Routes = Layer.mergeAll(
  HttpRouter.add("POST", "/start", asHttp(startSession), { uninterruptible: true }),
  HttpRouter.add("GET", "/image", asHttp(getImage), { uninterruptible: true }),
  HttpRouter.add("GET", "/stats", asHttp(getStats)),
  HttpRouter.add("POST", "/stop", asHttp(stopSession), { uninterruptible: true }),
  HttpRouter.add("POST", "/send-keys", asHttp(sendKeys), { uninterruptible: true }),
  HttpRouter.add("*", "/*", HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 })),
  Shutdown,
);

const App = HttpRouter.serve(Routes, {
  disableLogger: true,
  disableListenLog: true,
  // The old handler compared URL.pathname literally. FindMyWay's defaults
  // fold case, trailing slashes, and duplicate slashes.
  routerConfig: { caseSensitive: true, ignoreTrailingSlash: false, ignoreDuplicateSlashes: false },
}).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { host, port: Number(port) })),
);

NodeRuntime.runMain(Layer.launch(App));
