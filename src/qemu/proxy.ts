// The oligarchy proxy: a main file, not a library. It serves an HTTP control
// plane that boots QEMU sessions and drives them by session uuid.
//
//   node --experimental-strip-types src/qemu/proxy.ts <iso>
//
// The default iso comes from argv or OLIGARCHY_ISO; the listen address from
// OLIGARCHY_ADDR (default 127.0.0.1:42069). DATABASE_URL must point at the
// control-plane Postgres: every session and every session-scoped request is
// recorded there (see field-guide/database.md), and a proxy that cannot
// record is not allowed to boot.
//
//   POST /start      -> {"iso"?, "disk"?}; boots a qemu, returns {"id": uuid}
//                       an http(s) iso is downloaded into ~/.oligarchy/isos
//                       once (a start that finds a running download waits
//                       for it) and reused from there on later starts
//   GET  /image?id=  -> PNG of that session's guest display
//   GET  /stats      -> qemu count + host memory + cpu percentiles (last 5m)
//   POST /send-keys  -> {"id", "keys": "Hi<ENTER>", "encoding"?}
//   POST /stop       -> {"id"}; kills the qemu and removes its session dir
//   POST /finish     -> {"id", "status": "succeeded"|"failed", "reason"?};
//                       like /stop, but records the session's verdict
//
// A request carrying an x-oligarchy-agent header is attributed to that cloud
// agent; on /start the header also registers the agent as the session's
// driver.

import { createServer, type IncomingMessage } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  connectDatabase,
  endSession,
  insertSession,
  recordAction,
  recordImage,
  registerAgent,
  sessionRunning,
  type ActionKind,
} from "../db/ops.ts";
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

const db = connectDatabase();
const sessions = new Map<string, Qemu>();
const cpuSampler = startCpuSampler();

const [host, port] = addr.split(":");
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${addr}`);
    // Node lowercases header names and joins duplicates, so this is a plain
    // string whenever the client sent one.
    const agent = req.headers["x-oligarchy-agent"] as string | undefined;

    if (req.method === "POST" && url.pathname === "/start") {
      const raw = await body(req);
      const cfg = (raw === "" ? {} : JSON.parse(raw)) as { iso?: string; disk?: string };
      const iso = cfg.iso ?? defaultIso;
      const downloads = iso.startsWith("http://") || iso.startsWith("https://");
      const qemu = createQemu();
      // The session row exists before any boot work, so the download phase
      // and every failure land on a real row. config is the effective launch
      // config; the disk key stays absent when the server makes the disk.
      await insertSession(db, qemu.id, { iso, disk: cfg.disk }, downloads ? "downloading" : "running");
      try {
        // Inside the try: an agent already driving another session is a
        // failed start, and the session row must say so.
        if (agent !== undefined) {
          await registerAgent(db, agent, qemu.id);
        }
        await recorded(qemu.id, agent, "start", cfg, async () => {
          const isoPath = await getIso(iso);
          if (cfg.disk === undefined) {
            await createDisk(qemu);
          } else {
            // start() puts the firmware copy and the QMP socket in the
            // session dir; with a caller-provided disk, createDisk never
            // made it.
            await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
          }
          await start(qemu, { iso: isoPath, disk: cfg.disk });
          if (downloads) {
            await sessionRunning(db, qemu.id);
          }
        });
      } catch (err) {
        // A start that got as far as booting is torn down again: a session
        // whose id the client never learned must not stay running. The boot
        // error is the one worth seeing, so the cleanup failure is swallowed.
        await stop(qemu).catch(() => {});
        await endSession(db, qemu.id, "failed", errorMessage(err)).catch(logDbError);
        throw err;
      }
      sessions.set(qemu.id, qemu);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: qemu.id }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/image") {
      const qemu = session(url.searchParams.get("id"));
      const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
      // Not recorded through recorded(): the image row needs the action id.
      const startedAt = Date.now();
      let data: Buffer;
      try {
        try {
          await screendump(qemu, path);
          data = await readFile(path);
        } finally {
          await rm(path, { force: true });
        }
      } catch (err) {
        await recordAction(db, {
          sessionId: qemu.id,
          agentId: agent,
          kind: "get-image",
          request: {},
          error: errorMessage(err),
          durationMs: Date.now() - startedAt,
        }).catch(logDbError);
        throw err;
      }
      const actionId = await recordAction(db, {
        sessionId: qemu.id,
        agentId: agent,
        kind: "get-image",
        request: {},
        error: null,
        durationMs: Date.now() - startedAt,
      });
      await recordImage(db, actionId, data);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length });
      res.end(data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      const payload = JSON.stringify(collectStats(cpuSampler, sessions.size));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/stop") {
      const { id } = JSON.parse(await body(req)) as { id?: string };
      const qemu = session(id);
      await recorded(qemu.id, agent, "stop", {}, async () => {
        sessions.delete(qemu.id);
        await stop(qemu);
        // A stop is an end without a verdict.
        await endSession(db, qemu.id, "aborted", null);
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: "true" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/finish") {
      const { id, status, reason } = JSON.parse(await body(req)) as {
        id?: string;
        status?: string;
        reason?: string;
      };
      if (status !== "succeeded" && status !== "failed") {
        throw new Error(`finish: status must be "succeeded" or "failed", got "${status}"`);
      }
      const qemu = session(id);
      await recorded(qemu.id, agent, "finish", { status, reason }, async () => {
        sessions.delete(qemu.id);
        await stop(qemu);
        await endSession(db, qemu.id, status, reason ?? null);
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: "true" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/send-keys") {
      const { id, keys, encoding } = JSON.parse(await body(req)) as {
        id?: string;
        keys: string;
        encoding?: string;
      };
      const qemu = session(id);
      await recorded(qemu.id, agent, "send-keys", { keys, encoding }, async () => {
        for (const chord of parseKeys(keys, encoding)) {
          await sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })));
        }
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: "true" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: errorMessage(err) }));
  }
}).listen(Number(port), host, () => {
  console.error(`oligarchy proxy listening on ${addr}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Every session gets its own attempt: one failure must not keep the
    // others from being stopped and recorded, and the exit is unconditional.
    void Promise.all(
      [...sessions.values()].map(async (qemu) => {
        try {
          await stop(qemu);
          await endSession(db, qemu.id, "aborted", "proxy shutdown");
        } catch (err) {
          console.error(`shutdown: ${errorMessage(err)}`);
        }
      }),
    ).then(() => process.exit(0));
  });
}

/**
 * Times work, records it as one action row — error message on failure, null
 * on success — and passes the outcome through. Recording a success is part
 * of the operation and may fail it; recording a failure must not replace the
 * real error, so that write only logs.
 */
async function recorded<T>(
  sessionId: string,
  agentId: string | undefined,
  kind: ActionKind,
  request: unknown,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let result: T;
  try {
    result = await work();
  } catch (err) {
    await recordAction(db, {
      sessionId,
      agentId,
      kind,
      request,
      error: errorMessage(err),
      durationMs: Date.now() - startedAt,
    }).catch(logDbError);
    throw err;
  }
  await recordAction(db, { sessionId, agentId, kind, request, error: null, durationMs: Date.now() - startedAt });
  return result;
}

function logDbError(err: unknown): void {
  console.error(`db: ${errorMessage(err)}`);
}

// Drizzle wraps the postgres error the way fetch wraps network errors: the
// useful detail (duplicate key, connection refused) lives in the cause.
function errorMessage(err: unknown): string {
  const e = err as Error;
  return e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message;
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

async function body(req: IncomingMessage): Promise<string> {
  let out = "";
  for await (const chunk of req) {
    out += chunk;
  }
  return out;
}
