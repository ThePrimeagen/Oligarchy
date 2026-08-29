// The oligarchy proxy: a main file, not a library. It boots one QEMU
// session from CLI/env parameters and serves an HTTP control plane for it.
//
//   node --experimental-strip-types src/qemu/proxy.ts <iso>
//
// The iso comes from argv or OLIGARCHY_ISO; the listen address from
// OLIGARCHY_ADDR (default 127.0.0.1:42069).
//
//   GET  /image      -> PNG of the current guest display
//   POST /send-keys  -> {"keys": "Hi<ENTER>", "encoding": "oligarchy"}

import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createDisk, createQemu, screendump, sendKey, start, stop } from "./client.ts";
import { parseKeys } from "./keys.ts";

const iso = process.argv[2] ?? process.env.OLIGARCHY_ISO;
if (iso === undefined) {
  console.error("usage: proxy <iso>  (or set OLIGARCHY_ISO)");
  process.exit(1);
}
const addr = process.env.OLIGARCHY_ADDR ?? "127.0.0.1:42069";

const qemu = createQemu();
await createDisk(qemu);
await start(qemu, { iso });

const [host, port] = addr.split(":");
createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/image") {
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

    if (req.method === "POST" && req.url === "/send-keys") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      const { keys, encoding } = JSON.parse(body) as { keys: string; encoding?: string };
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
}).listen(Number(port), host, () => {
  console.error(`oligarchy proxy listening on ${addr}, session ${qemu.id}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stop(qemu).then(() => process.exit(0));
  });
}
