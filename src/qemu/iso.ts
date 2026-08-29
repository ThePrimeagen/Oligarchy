// ISO resolution for the proxy. getIso turns whatever a client named as
// "iso" into an absolute file path: a plain path is resolved and must
// exist, an http(s) url is downloaded into ~/.oligarchy/isos once and
// served from the cache ever after. manifest.json sits beside the cached
// isos and records when each was cached and last used, so the cache can be
// pruned by size later.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { Stats } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ISO_DIR = join(homedir(), ".oligarchy", "isos");
const MANIFEST_PATH = join(ISO_DIR, "manifest.json");

type ManifestEntry = {
  cachedAt: string;
  lastUsedAt: string;
};

export async function getIso(name: string): Promise<string> {
  if (!name.startsWith("http://") && !name.startsWith("https://")) {
    const path = resolve(name);
    let info: Stats;
    try {
      info = await stat(path);
    } catch {
      throw new Error(`iso: not found: ${path}`);
    }
    // QEMU's own complaint about a non-file lands in stdio "ignore"; name
    // the problem here instead.
    if (!info.isFile()) {
      throw new Error(`iso: not a file: ${path}`);
    }
    return path;
  }

  const file = cacheFileName(name);
  // A fleet booting the same new iso means many concurrent /start calls;
  // they collapse onto one download instead of one each.
  const inflight = downloads.get(file);
  if (inflight !== undefined) {
    return inflight;
  }
  const promise = downloadCached(name, file).finally(() => downloads.delete(file));
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

async function downloadCached(url: string, file: string): Promise<string> {
  const path = join(ISO_DIR, file);
  await mkdir(ISO_DIR, { recursive: true });
  const cached = await stat(path).then(
    () => true,
    () => false,
  );
  if (!cached) {
    await download(url, path);
  }
  const now = new Date().toISOString();
  await updateManifest(file, (entry) => ({
    cachedAt: entry?.cachedAt ?? now,
    lastUsedAt: now,
  }));
  return path;
}

async function download(url: string, path: string): Promise<void> {
  console.error(`iso: downloading ${url} -> ${path}`);
  const res = await fetch(url);
  if (!res.ok || res.body === null) {
    throw new Error(`iso: download failed: ${url}: HTTP ${res.status}`);
  }
  // Written beside the final name and renamed into place on success, so a
  // file under the cached name is always a complete download; the pid keeps
  // two proxies on one machine out of each other's partials.
  const partial = `${path}.partial-${process.pid}`;
  const hash = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      // Hash the bytes on their way to disk; an iso runs to gigabytes and
      // is not worth a second read.
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(partial),
    );
    const digest = hash.digest("hex");
    const published = await publishedSha256(url);
    if (published === undefined) {
      console.error(`iso: no ${url}.sha256 published; skipping the checksum check`);
    } else if (published !== digest) {
      throw new Error(`iso: sha256 mismatch: ${url}: published ${published}, downloaded ${digest}`);
    }
    await rename(partial, path);
    console.error(`iso: cached ${url} -> ${path}`);
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

// Every manifest write is a read-modify-write of the whole file; the chain
// keeps concurrent starts for different isos from interleaving and losing
// an entry. A failed write must not wedge the writes after it.
let manifestChain: Promise<unknown> = Promise.resolve();

function updateManifest(
  file: string,
  update: (entry: ManifestEntry | undefined) => ManifestEntry,
): Promise<void> {
  const step = manifestChain.then(async () => {
    let manifest: Record<string, ManifestEntry> = {};
    try {
      manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Record<string, ManifestEntry>;
    } catch (err) {
      // No manifest yet — the first cached iso creates it.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
    manifest[file] = update(manifest[file]);
    // Temp-write and rename so a crash cannot leave a truncated manifest.
    const partial = `${MANIFEST_PATH}.partial-${process.pid}`;
    await writeFile(partial, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(partial, MANIFEST_PATH);
  });
  manifestChain = step.catch(() => {});
  return step;
}
