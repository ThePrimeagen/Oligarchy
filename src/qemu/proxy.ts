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

import { createServer, type IncomingMessage } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
  return (command) => {
    const opened = startAction(db, { sessionId, agentId, request: command });
    return async (outcome) => {
      await finishAction(db, await opened, outcome);
    };
  };
}

const [host, port] = addr.split(":");
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${addr}`);

    if (req.method === "POST" && url.pathname === "/start") {
      const raw = await body(req);
      const cfg = (raw === "" ? {} : JSON.parse(raw)) as { iso?: string; disk?: string; agent?: string };
      const isoName = cfg.iso ?? defaultIso;
      const isUrl = isoName.startsWith("http://") || isoName.startsWith("https://");
      const qemu = createQemu();
      // The session row exists before any boot work, so iso events have a
      // session to hang on: a url iso enters as "downloading", a local path
      // goes straight to "running".
      await insertSession(db, qemu.id, { iso: isoName, disk: cfg.disk }, isUrl ? "downloading" : "running");
      if (cfg.agent !== undefined) {
        await registerAgent(db, cfg.agent, qemu.id);
      }
      try {
        const iso = await getIso(db, isoName, { sessionId: qemu.id, agentId: cfg.agent });
        if (cfg.disk === undefined) {
          await createDisk(qemu);
        } else {
          // start() puts the firmware copy and the QMP socket in the session
          // dir; with a caller-provided disk, createDisk never made it.
          await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
        }
        await start(qemu, { iso, disk: cfg.disk }, recorder(qemu.id, cfg.agent));
      } catch (err) {
        // The session's record must say it never made it up; the boot error
        // is the one worth seeing if even that write fails.
        await endSession(db, qemu.id, "failed", (err as Error).message).catch((e: unknown) => {
          console.error(`db: recording a failed start failed too: ${(e as Error).message}`);
        });
        throw err;
      }
      if (isUrl) {
        await sessionRunning(db, qemu.id);
      }
      sessions.set(qemu.id, qemu);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: qemu.id }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/image") {
      const qemu = session(url.searchParams.get("id"));
      const agent = url.searchParams.get("agent") ?? undefined;
      const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
      // The PNG is read back only after the exchange closes, and the images
      // row must ride the same transaction that closes the action (they are
      // 1:1) — so the recorder only stashes, and the handler closes.
      let opened: Promise<number> | undefined;
      let outcome: QemuExchangeOutcome | undefined;
      try {
        await screendump(qemu, path, "png", (command) => {
          opened = startAction(db, { sessionId: qemu.id, agentId: agent, request: command });
          return async (result) => {
            outcome = result;
          };
        });
        const data = await readFile(path);
        // screendump resolved, so the recorder ran: opened and outcome are set.
        await finishAction(db, await opened!, outcome!, data);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length });
        res.end(data);
      } catch (err) {
        // A failed exchange still gets closed — just without an image; the
        // exchange error is the one worth seeing if the close fails too.
        if (opened !== undefined && outcome !== undefined) {
          await finishAction(db, await opened, outcome).catch((e: unknown) => {
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
      const qemu = session(id);
      sessions.delete(qemu.id);
      await stop(qemu);
      // The stop ends the session; a stop without a verdict is an abort.
      await endSession(db, qemu.id, status ?? "aborted", reason ?? null);
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
      const qemu = session(id);
      const record = recorder(qemu.id, agent);
      for (const chord of parseKeys(keys, encoding)) {
        await sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })), record);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: "true" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}).listen(Number(port), host, () => {
  console.error(`oligarchy proxy listening on ${addr}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all(
      [...sessions.values()].map(async (qemu) => {
        await stop(qemu);
        await endSession(db, qemu.id, "aborted", "proxy shutdown");
      }),
    ).then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(`shutdown: ${(err as Error).message}`);
        process.exit(1);
      },
    );
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
