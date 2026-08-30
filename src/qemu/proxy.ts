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

import { createServer, type IncomingMessage } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${addr}`);

    if (req.method === "POST" && url.pathname === "/start") {
      const started = Date.now();
      const raw = await body(req);
      const cfg = (raw === "" ? {} : JSON.parse(raw)) as { iso?: string; disk?: string; agent?: string };
      const isoName = cfg.iso ?? defaultIso;
      const isUrl = isoName.startsWith("http://") || isoName.startsWith("https://");
      const qemu = createQemu();
      // The session row exists before any boot work, so iso events have a
      // session to hang on: a url iso enters as "downloading", a local path
      // goes straight to "running".
      await insertSession(db, qemu.id, { iso: isoName, disk: cfg.disk }, isUrl ? "downloading" : "running");
      log(db, {
        text: `session ${qemu.id}: starting; iso ${isoName}${cfg.disk === undefined ? "" : `, disk ${cfg.disk}`}`,
        sessionId: qemu.id,
        agentId: cfg.agent,
      });
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
      sessions.set(qemu.id, qemu);
      // Wall time from request to a live QMP handshake, download included —
      // per-exchange timing lives on the action rows.
      log(db, { text: `session ${qemu.id}: running; started in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: cfg.agent });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: qemu.id }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/image") {
      const started = Date.now();
      const qemu = session(url.searchParams.get("id"));
      const agent = url.searchParams.get("agent") ?? undefined;
      const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
      // The PNG is read back only after the exchange closes, and the images
      // row must ride the same transaction that closes the action (they are
      // 1:1) — so the recorder only stashes, and the handler closes.
      let opened: number | undefined;
      let outcome: QemuExchangeOutcome | undefined;
      try {
        await screendump(qemu, path, "png", async (command) => {
          opened = await startAction(db, { sessionId: qemu.id, agentId: agent, request: command });
          return async (result) => {
            outcome = result;
          };
        });
        const data = await readFile(path);
        // screendump resolved, so the recorder ran: opened and outcome are set.
        await finishAction(db, opened!, outcome!, data);
        log(db, { text: `session ${qemu.id}: image; ${data.length} bytes in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length });
        res.end(data);
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
      return;
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      const payload = JSON.stringify(collectStats(cpuSampler, sessions.size));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/stop") {
      const { id, status, reason } = JSON.parse(await body(req)) as {
        id?: string;
        status?: "succeeded" | "failed" | "aborted";
        reason?: string;
      };
      // The verdict is checked before the machine dies: a bad status must
      // not kill the qemu and then fail to record the end.
      if (status !== undefined && status !== "succeeded" && status !== "failed" && status !== "aborted") {
        throw new Error(`unknown status "${status as string}"`);
      }
      const qemu = session(id);
      sessions.delete(qemu.id);
      await stop(qemu);
      // The stop ends the session; a stop without a verdict is an abort.
      await endSession(db, qemu.id, status ?? "aborted", reason ?? null);
      log(db, {
        text: `session ${qemu.id}: stopped; ${status ?? "aborted"}${reason === undefined ? "" : `; ${reason}`}`,
        sessionId: qemu.id,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: "true" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/send-keys") {
      const { id, keys, encoding, agent } = JSON.parse(await body(req)) as {
        id?: string;
        keys: string;
        encoding?: string;
        agent?: string;
      };
      const started = Date.now();
      const qemu = session(id);
      const record = recorder(qemu.id, agent);
      const chords = parseKeys(keys, encoding);
      for (const chord of chords) {
        await sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })), record);
      }
      // The request-level story; each chord is its own action row with its
      // own timing.
      log(db, { text: `session ${qemu.id}: sent ${chords.length} chords in ${Date.now() - started}ms`, sessionId: qemu.id, agentId: agent });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: "true" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    // One error line per failed request. Session attribution lives where
    // the detail does: a failed start on the session row's reason, a failed
    // exchange on its action row.
    log(db, { level: "error", text: `${req.method ?? ""} ${req.url ?? "/"} failed: ${(err as Error).message}` });
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
})
  .on("error", (err) => {
    // The listen failing (the port is taken) or the acceptor breaking is
    // the death of the proxy: say so, get the line out, and go down.
    log(db, { level: "fatal", text: `proxy: ${err.message}` });
    void flushLogs().then(() => process.exit(1));
  })
  .listen(Number(port), host, () => {
    log(db, `oligarchy proxy listening on ${addr}`);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log(db, `proxy: ${signal}; stopping ${sessions.size} sessions`);
    // Settled, not raced: one session failing to stop or record must not
    // cut short the cleanup of the others.
    void Promise.allSettled(
      [...sessions.values()].map(async (qemu) => {
        await stop(qemu);
        await endSession(db, qemu.id, "aborted", "proxy shutdown");
        log(db, { text: `session ${qemu.id}: stopped; aborted; proxy shutdown`, sessionId: qemu.id });
      }),
    ).then(async (results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          log(db, { level: "error", text: `shutdown: ${(result.reason as Error).message}` });
        }
      }
      // The exit must not outrun the queued rows — the shutdown story is
      // the part most worth having when the proxy is gone.
      await flushLogs();
      process.exit(results.some((result) => result.status === "rejected") ? 1 : 0);
    });
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

async function body(req: IncomingMessage): Promise<string> {
  let out = "";
  for await (const chunk of req) {
    out += chunk;
  }
  return out;
}
