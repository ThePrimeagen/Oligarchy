// ISO resolution for the proxy. getIso turns whatever a client named as
// "iso" into an absolute file path: a plain path is resolved and must
// exist, an http(s) url is downloaded into ~/.oligarchy/isos once and
// served from the cache ever after. manifest.json sits beside the cached
// isos and records when each was cached and last used, so the cache can be
// pruned by size later — and, while a download runs, carries its claim so
// other proxies wait for it instead of downloading the same iso twice.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { Stats } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { log } from "../db/log.ts";
import type { Db } from "../db/ops.ts";

// Who an iso event is logged for: the session whose /start needs the iso,
// and the agent driving it when there is one.
type Who = { sessionId: string; agentId?: string };

const ISO_DIR = join(homedir(), ".oligarchy", "isos");
const MANIFEST_PATH = join(ISO_DIR, "manifest.json");

// A downloader refreshes its claim's heartbeat while bytes flow; waiters
// recheck on the same ten-second cadence and treat three missed beats as a
// dead downloader.
const HEARTBEAT_MS = 10_000;
const POLL_MS = 10_000;
const STALE_MS = 3 * HEARTBEAT_MS;

// Per cached file: either a live download claim (heartbeatAt advances while
// bytes flow) or the cached timestamps pruning will need later.
type ManifestEntry =
  | { status: "downloading"; heartbeatAt: string }
  | { status: "cached"; cachedAt: string; lastUsedAt: string };

export async function getIso(db: Db, name: string, who: Who): Promise<string> {
  if (!name.startsWith("http://") && !name.startsWith("https://")) {
    const path = resolve(name);
    let info: Stats;
    try {
      info = await stat(path);
    } catch {
      throw new Error(`iso: not found: ${path}`);
    }
    // The path for "--iso ~/isos" instead of the file inside it: QEMU's own
    // complaint would land in stdio "ignore", so name the mistake here.
    if (info.isDirectory()) {
      throw new Error(`iso: is a directory: ${path}`);
    }
    return path;
  }

  const file = cacheFileName(name);
  // A fleet booting the same new iso means many concurrent /start calls;
  // they collapse onto one download instead of one each (attributed to the
  // session that got here first).
  const inflight = downloads.get(file);
  if (inflight !== undefined) {
    return inflight;
  }
  const promise = downloadCached(db, name, file, who).finally(() => downloads.delete(file));
  downloads.set(file, promise);
  return promise;
}

// A cached iso is named by its url with ':' and '/' — and every other
// character a file name cannot hold — replaced by '_'. Everything legal
// stays, so the name remains recognizable:
//   https://iso.omarchy.org/omarchy-3.0.iso -> https___iso.omarchy.org_omarchy-3.0.iso
function cacheFileName(url: string): string {
  // oxlint-disable-next-line no-control-regex -- control chars are in the forbidden set
  return url.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

const downloads = new Map<string, Promise<string>>();

async function downloadCached(db: Db, url: string, file: string, who: Who): Promise<string> {
  const path = join(ISO_DIR, file);
  await mkdir(ISO_DIR, { recursive: true });
  let waitLogged = false;
  for (;;) {
    // Another proxy mid-download shows up as a claim with a live heartbeat:
    // wait for its rename instead of downloading the same iso twice. A stale
    // heartbeat is a dead downloader and gets walked over. Two proxies
    // claiming in the same instant both download — wasteful, still correct,
    // since each streams its own partial and the rename is atomic.
    const entry = (await readManifest())[file];
    if (entry?.status === "downloading" && Date.now() - Date.parse(entry.heartbeatAt) < STALE_MS) {
      if (!waitLogged) {
        log(db, { text: `iso: another download of ${url} is running; waiting for it`, ...who });
        waitLogged = true;
      }
      await sleep(POLL_MS);
      continue;
    }
    // The claim is checked before the file so a download that finishes
    // between the two reads is still seen here and not downloaded again.
    const cached = await stat(path).then(
      () => true,
      () => false,
    );
    if (cached) {
      log(db, { text: `iso: cache hit ${url} -> ${path}`, ...who });
      await updateManifest(file, "cached");
      return path;
    }
    await updateManifest(file, "downloading");
    try {
      await download(db, url, file, path, who);
    } catch (err) {
      // Drop the claim so waiters take over right away; if even this write
      // fails, they still recover once the heartbeat goes stale.
      await updateManifest(file, "removed").catch(() => {});
      throw err;
    }
    await updateManifest(file, "cached");
    return path;
  }
}

async function download(db: Db, url: string, file: string, path: string, who: Who): Promise<void> {
  log(db, { text: `iso: downloading ${url} -> ${path}`, ...who });
  const res = await fetch(url);
  if (!res.ok || res.body === null) {
    throw new Error(`iso: download failed: ${url}: HTTP ${res.status}`);
  }
  // Written beside the final name and renamed into place on success, so a
  // file under the cached name is always a complete download; the pid keeps
  // two proxies on one machine out of each other's partials.
  const partial = `${path}.partial-${process.pid}`;
  const hash = createHash("sha256");
  let beatAt = Date.now();
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      // Hash the bytes on their way to disk; an iso runs to gigabytes and
      // is not worth a second read.
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          // Keep the claim's heartbeat fresh while bytes flow. A failed
          // beat only risks a duplicate download elsewhere, never this one.
          if (Date.now() - beatAt >= HEARTBEAT_MS) {
            beatAt = Date.now();
            updateManifest(file, "downloading").catch((err: unknown) => {
              log(db, { text: `iso: heartbeat failed: ${(err as Error).message}`, ...who });
            });
          }
          yield chunk;
        }
      },
      createWriteStream(partial),
    );
    const digest = hash.digest("hex");
    const published = await publishedSha256(url);
    if (published === undefined) {
      log(db, { text: `iso: no ${url}.sha256 published; skipping the checksum check`, ...who });
    } else if (published !== digest) {
      throw new Error(`iso: sha256 mismatch: ${url}: published ${published}, downloaded ${digest}`);
    }
    await rename(partial, path);
    log(db, { text: `iso: cached ${url} -> ${path}`, ...who });
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
}

// Publishers put a sha256sum-style sidecar ("<hex>  <name>") beside the iso
// at <url>.sha256 — omarchy does. Its first token is the digest. An iso
// without one gets no check: there is nothing to check against — and a 200
// whose body is not a digest (a soft-404 page) counts as no sidecar too,
// not as a mismatch.
async function publishedSha256(url: string): Promise<string | undefined> {
  const res = await fetch(`${url}.sha256`);
  if (!res.ok) {
    return undefined;
  }
  const token = (await res.text()).trim().split(/\s+/)[0].toLowerCase();
  return /^[0-9a-f]{64}$/.test(token) ? token : undefined;
}

async function readManifest(): Promise<Record<string, ManifestEntry>> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Record<string, ManifestEntry>;
  } catch (err) {
    // No manifest yet — the first cached iso creates it.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    return {};
  }
}

// Every manifest write is a read-modify-write of the whole file; the chain
// keeps concurrent starts for different isos from interleaving and losing
// an entry. A failed write must not wedge the writes after it.
let manifestChain: Promise<unknown> = Promise.resolve();

function updateManifest(file: string, state: "cached" | "downloading" | "removed"): Promise<void> {
  const step = manifestChain.then(async () => {
    const manifest = await readManifest();
    const entry = manifest[file];
    const now = new Date().toISOString();
    if (state === "removed") {
      delete manifest[file];
    } else if (state === "downloading") {
      manifest[file] = { status: "downloading", heartbeatAt: now };
    } else {
      // A fresh cache gets both stamps; a hit only moves lastUsedAt.
      manifest[file] = {
        status: "cached",
        cachedAt: entry?.status === "cached" ? entry.cachedAt : now,
        lastUsedAt: now,
      };
    }
    // Temp-write and rename so a crash cannot leave a truncated manifest.
    const partial = `${MANIFEST_PATH}.partial-${process.pid}`;
    await writeFile(partial, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(partial, MANIFEST_PATH);
  });
  manifestChain = step.catch(() => {});
  return step;
}
