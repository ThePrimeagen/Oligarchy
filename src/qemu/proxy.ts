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

import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { connectDatabase, endSession, finishAction, insertSession, registerAgent, sessionRunning, startAction } from "../db/ops.ts";
import { createDisk, createQemu, screendump, sendKey, start, stop, type Qemu } from "./client.ts";
import { api, errorResponses } from "./http.ts";
import { getIso } from "./iso.ts";
import { parseKeys } from "./keys.ts";
import { collectStats, startCpuSampler } from "./stats.ts";

const defaultIso = process.argv[2] ?? process.env.OLIGARCHY_ISO;
if (defaultIso === undefined) {
  console.error("usage: proxy <iso>  (or set OLIGARCHY_ISO)");
  process.exit(1);
}
const addr = process.env.OLIGARCHY_ADDR ?? "127.0.0.1:42069";

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

const [host, port] = addr.split(":");
const controlLayer = HttpApiBuilder.group(api, "control", (handlers) =>
  handlers.handleAll({
    start: ({ payload }) =>
      Effect.tryPromise({
        try: async () => {
          const cfg = payload ?? {};
          const isoName = cfg.iso ?? defaultIso;
          const isUrl =
            isoName.startsWith("http://") ||
            isoName.startsWith("https://");
          const qemu = createQemu();
          // The session row exists before any boot work, so iso events have a
          // session to hang on: a url iso enters as "downloading", a local path
          // goes straight to "running".
          await insertSession(
            db,
            qemu.id,
            { iso: isoName, disk: cfg.disk },
            isUrl ? "downloading" : "running",
          );
          try {
            // Inside the try: a rejected registration (the agent already drives
            // a session) must close this session as failed, not leave it open.
            if (cfg.agent !== undefined) {
              await registerAgent(db, cfg.agent, qemu.id);
            }
            const iso = await getIso(db, isoName, {
              sessionId: qemu.id,
              agentId: cfg.agent,
            });
            if (cfg.disk === undefined) {
              await createDisk(qemu);
            } else {
              // start() puts the firmware copy and the QMP socket in the session
              // dir; with a caller-provided disk, createDisk never made it.
              await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
            }
            await start(
              qemu,
              { iso, disk: cfg.disk },
              recorder(qemu.id, cfg.agent),
            );
            if (isUrl) {
              await sessionRunning(db, qemu.id);
            }
          } catch (err) {
            // The qemu must not outlive its failed start — a machine the map
            // never held would be unreachable and unkillable through the API.
            // The boot error is the one worth seeing if cleanup fails too.
            await stop(qemu).catch(() => {});
            await endSession(
              db,
              qemu.id,
              "failed",
              err instanceof Error ? err.message : String(err),
            ).catch((recordError: unknown) => {
              console.error(
                `db: recording a failed start failed too: ${
                  recordError instanceof Error
                    ? recordError.message
                    : String(recordError)
                }`,
              );
            });
            throw err;
          }
          sessions.set(qemu.id, qemu);
          return { id: qemu.id };
        },
        catch: operationError,
      }),
    image: ({ query }) =>
      Effect.tryPromise({
        try: async () => {
          const qemu = session(query.id);
          const agent = query.agent;
          const path = join(
            qemu.dir,
            `image-${process.hrtime.bigint()}.png`,
          );
          // The PNG is read back only after the exchange closes, and the images
          // row must ride the same transaction that closes the action (they are
          // 1:1) — so the recorder only stashes, and the handler closes.
          let opened: number | undefined;
          let outcome: QemuExchangeOutcome | undefined;
          try {
            await screendump(qemu, path, "png", async (command) => {
              opened = await startAction(db, {
                sessionId: qemu.id,
                agentId: agent,
                request: command,
              });
              return async (result) => {
                outcome = result;
              };
            });
            const data = await readFile(path);
            // screendump resolved, so the recorder ran: opened and outcome are set.
            if (opened === undefined || outcome === undefined) {
              throw new Error(
                "screendump completed without a recorded QMP exchange",
              );
            }
            await finishAction(db, opened, outcome, data);
            return data;
          } catch (err) {
            // Only a failed exchange is closed without an image. A completed one
            // whose image write failed stays open — the row state database.md
            // documents as a completion that was never persisted; closing it
            // imageless would break the 1:1 promise instead.
            if (
              opened !== undefined &&
              outcome !== undefined &&
              outcome.state === "failed"
            ) {
              await finishAction(db, opened, outcome).catch(
                (recordError: unknown) => {
                  console.error(
                    `db: recording a failed screendump failed too: ${
                      recordError instanceof Error
                        ? recordError.message
                        : String(recordError)
                    }`,
                  );
                },
              );
            }
            throw err;
          } finally {
            await rm(path, { force: true });
          }
        },
        catch: operationError,
      }),
    stats: () => Effect.sync(() => collectStats(cpuSampler, sessions.size)),
    stop: ({ payload: { id, status, reason } }) =>
      Effect.tryPromise({
        try: async () => {
          const qemu = session(id);
          sessions.delete(qemu.id);
          await stop(qemu);
          // The stop ends the session; a stop without a verdict is an abort.
          await endSession(
            db,
            qemu.id,
            status ?? "aborted",
            reason ?? null,
          );
          return { ok: "true" };
        },
        catch: operationError,
      }),
    sendKeys: ({ payload: { id, keys, encoding, agent } }) =>
      Effect.tryPromise({
        try: async () => {
          const qemu = session(id);
          const record = recorder(qemu.id, agent);
          for (const chord of parseKeys(keys, encoding)) {
            await sendKey(
              qemu,
              chord.map(
                (code): QemuKeyValue => ({ type: "qcode", data: code }),
              ),
              record,
            );
          }
          return { ok: "true" };
        },
        catch: operationError,
      }),
  }),
);

const apiLayer = HttpRouter.serve(
  Layer.mergeAll(
    HttpApiBuilder.layer(api).pipe(Layer.provide(controlLayer)),
    errorResponses,
  ),
  { disableLogger: true },
).pipe(
  Layer.provide(
    NodeHttpServer.layer(createServer, { host, port: Number(port) }),
  ),
);

Layer.launch(apiLayer).pipe(
  Effect.ensuring(shutdownSessions()),
  NodeRuntime.runMain,
);

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

function operationError(cause: unknown): Error & { readonly error: string } {
  const error =
    cause instanceof Error
      ? cause
      : new Error("internal server error", { cause });
  return Object.assign(error, { error: error.message });
}

function shutdownSessions(): Effect.Effect<void> {
  return Effect.promise(async () => {
    // Settled, not raced: one session failing to stop or record must not
    // cut short the cleanup of the others.
    const results = await Promise.allSettled(
      [...sessions.values()].map(async (qemu) => {
        await stop(qemu);
        await endSession(db, qemu.id, "aborted", "proxy shutdown");
      }),
    );
    let failed = false;
    for (const result of results) {
      if (result.status === "rejected") {
        failed = true;
        const error = result.reason;
        console.error(
          `shutdown: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failed) {
      throw new Error("one or more sessions failed to shut down");
    }
  });
}
