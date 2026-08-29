// The oligarchy proxy: an HTTP control plane that boots QEMU sessions and
// drives them by session uuid.
//
//   node --experimental-strip-types src/qemu/proxy.ts <iso>
//
// The default iso comes from argv or OLIGARCHY_ISO; the listen address from
// OLIGARCHY_ADDR (default 127.0.0.1:42069).
//
//   POST /start      -> {"iso"?, "disk"?}; boots a qemu, returns {"id": uuid}
//   GET  /image?id=  -> PNG of that session's guest display
//   GET  /stats      -> live sessions + whatever host stats the system offers
//   POST /send-keys  -> {"id", "keys": "Hi<ENTER>", "encoding"?}
//   POST /stop       -> {"id"}; kills the qemu and removes its session dir
//
// createProxy is exported so tests can drive the routes on an ephemeral port;
// the main block below only runs when this file is executed directly.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createDisk, createQemu, screendump, sendKey, start, stop, type Qemu } from "./client.ts";
import { parseKeys } from "./keys.ts";
import { collectStats, createStatsCollector, type StatsCollector } from "./stats.ts";

export type ProxyOptions = {
  defaultIso: string;
  stats?: StatsCollector;
};

export type Proxy = {
  readonly server: Server;
  readonly sessions: Map<string, Qemu>;
  readonly defaultIso: string;
  readonly stats: StatsCollector;
};

export function createProxy(options: ProxyOptions): Proxy {
  const sessions = new Map<string, Qemu>();
  const stats = options.stats ?? createStatsCollector();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://oligarchy");

      if (req.method === "POST" && url.pathname === "/start") {
        const raw = await body(req);
        const cfg = (raw === "" ? {} : JSON.parse(raw)) as { iso?: string; disk?: string };
        const qemu = createQemu();
        if (cfg.disk === undefined) {
          await createDisk(qemu);
        }
        await start(qemu, { iso: cfg.iso ?? options.defaultIso, disk: cfg.disk });
        sessions.set(qemu.id, qemu);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: qemu.id }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/image") {
        const qemu = session(sessions, url.searchParams.get("id"));
        const path = join(qemu.dir, `image-${process.hrtime.bigint()}.png`);
        try {
          await screendump(qemu, path);
          const data = await readFile(path);
          res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length });
          res.end(data);
        } finally {
          await rm(path, { force: true });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/stats") {
        const instances = [...sessions.values()].map((qemu) => ({
          id: qemu.id,
          pid: qemu.proc?.pid ?? null,
        }));
        const payload = await collectStats(stats, instances);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === "POST" && url.pathname === "/stop") {
        const { id } = JSON.parse(await body(req)) as { id?: string };
        const qemu = session(sessions, id);
        sessions.delete(qemu.id);
        await stop(qemu);
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
        const qemu = session(sessions, id);
        for (const chord of parseKeys(keys, encoding)) {
          await sendKey(qemu, chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })));
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
  });

  return { server, sessions, stats, defaultIso: options.defaultIso };
}

function session(sessions: Map<string, Qemu>, id: string | null | undefined): Qemu {
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

if (import.meta.filename === process.argv[1]) {
  const defaultIso = process.argv[2] ?? process.env.OLIGARCHY_ISO;
  if (defaultIso === undefined) {
    console.error("usage: proxy <iso>  (or set OLIGARCHY_ISO)");
    process.exit(1);
  }
  const addr = process.env.OLIGARCHY_ADDR ?? "127.0.0.1:42069";
  const [host, port] = addr.split(":");

  const proxy = createProxy({ defaultIso });
  proxy.server.listen(Number(port), host, () => {
    console.error(`oligarchy proxy listening on ${addr}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.all([...proxy.sessions.values()].map(stop)).then(() => process.exit(0));
    });
  }
}
