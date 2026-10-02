import * as z from "zod";
import { codeOf } from "./errors.ts";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";
import * as Io from "./io.ts";
import { type Answer, failed, check, QemuFailed } from "./errors.ts";
export const cacheFileName = (name: string) =>
  Array.from(name, (c) => (/[<>:"/\\|?*]/.test(c) || c.charCodeAt(0) < 32 ? "_" : c)).join("");
const remote = (name: string) => /^https?:\/\//.test(name);
export type Iso = {
  readonly service: "iso";
  readonly pathOf: (name: string) => string;
  readonly get: (name: string, signal: AbortSignal) => Answer<string>;
  readonly close: () => Promise<void>;
};
declare module "@oligarchy/app" {
  interface Services {
    iso: App.Register<"iso", Iso>;
  }
}
export type Options = {
  readonly dataDir: string;
  readonly downloadMs: number;
  readonly pollMs: number;
  readonly staleMs: number;
  readonly heartbeatMs: number;
  readonly progressMs: number;
  readonly os?: Io.Os;
};
const Manifest = z.record(
  z.string(),
  z.object({
    status: z.enum(["cached", "downloading"]),
    cachedAt: z.string().optional(),
    lastUsedAt: z.string().optional(),
    heartbeatAt: z.string().optional(),
  }),
);
const Lease = z.object({ pid: z.int().positive(), at: z.number().finite() });
export const create = App.createService<Http.Http | Logger.Logger, Options, Iso>(
  (services, options) => {
    const os = options.os ?? Io.node;
    const controller = new AbortController();
    const flights = new Map<string, Answer<string>>();
    let manifestWork = Promise.resolve();
    const manifestPath = join(resolve(options.dataDir), "isos", "manifest.json");
    const updateManifest = (name: string, state: "cached" | "downloading" | "removed") => {
      const work = manifestWork.then(async () => {
        let manifest: z.infer<typeof Manifest> = {};
        try {
          manifest = Manifest.parse(JSON.parse(await os.fs.readFile(manifestPath, "utf8")));
        } catch (error) {
          if (codeOf(error) !== "ENOENT") throw error;
        }
        const key = cacheFileName(name),
          now = new Date().toISOString();
        if (state === "removed") delete manifest[key];
        else
          manifest[key] =
            state === "downloading"
              ? { status: state, heartbeatAt: now }
              : { status: state, cachedAt: manifest[key]?.cachedAt ?? now, lastUsedAt: now };
        const partial = `${manifestPath}.partial-${crypto.randomUUID()}`;
        try {
          await os.fs.writeFile(partial, JSON.stringify(manifest));
          await os.fs.rename(partial, manifestPath);
        } finally {
          await os.fs.rm(partial, { force: true });
        }
      });
      manifestWork = work.catch(() => {});
      return work;
    };
    const pathOf = (name: string) =>
      remote(name) ? join(resolve(options.dataDir), "isos", cacheFileName(name)) : resolve(name);
    const present = async (path: string) => {
      try {
        const stat = await os.fs.stat(path);
        if (!stat.isFile()) throw new QemuFailed(`${path} is not a file`);
        return true;
      } catch (error) {
        if (codeOf(error) === "ENOENT") return false;
        throw error;
      }
    };
    const download = (name: string): Answer<string> =>
      jarl.exec(async () => {
        const target = pathOf(name),
          lock = `${target}.lock`;
        await os.fs.mkdir(join(resolve(options.dataDir), "isos"), { recursive: true });
        while (true) {
          check(controller.signal);
          if (await present(target)) {
            await updateManifest(name, "cached");
            return target;
          }
          try {
            await os.fs.mkdir(lock);
            break;
          } catch (error) {
            if (codeOf(error) !== "EEXIST") throw error;
            try {
              const stat = await os.fs.stat(lock);
              const lease = Lease.parse(
                JSON.parse(await os.fs.readFile(join(lock, "owner"), "utf8")),
              );
              let alive = true;
              try {
                os.kill(lease.pid, 0);
              } catch (e) {
                alive = codeOf(e) !== "ESRCH";
              }
              if (!alive && Date.now() - Math.max(lease.at, stat.mtimeMs) > options.staleMs) {
                const stale = `${lock}.stale-${crypto.randomUUID()}`;
                await os.fs.rename(lock, stale);
                await os.fs.rm(stale, { recursive: true, force: true });
              }
            } catch (e) {
              if (codeOf(e) !== "ENOENT") throw e;
              const stat = await os.fs.stat(lock).catch(() => undefined);
              if (stat && Date.now() - stat.mtimeMs > options.staleMs)
                await os.fs.rm(lock, { recursive: true, force: true });
            }
            jarl.unwrap(await Async.sleep(options.pollMs, controller.signal));
          }
        }
        const partial = `${target}.partial-${crypto.randomUUID()}`;
        let bytes = 0;
        let response: Http.HttpResponse | undefined;
        let writing: Promise<unknown> = Promise.resolve();
        const beat = () => {
          writing = writing
            .then(() =>
              os.fs.writeFile(
                join(lock, "owner"),
                JSON.stringify({ pid: process.pid, at: Date.now() }),
              ),
            )
            .catch((error) => {
              services.logger.warning(`ISO heartbeat failed: ${String(error)}`);
            });
        };
        beat();
        await writing;
        const heartbeat = setInterval(beat, options.heartbeatMs);
        const progress = setInterval(
          () =>
            services.logger.info(`ISO ${name}: downloaded ${bytes} bytes`, {
              location: "qemu-runner",
            }),
          options.progressMs,
        );
        try {
          await updateManifest(name, "downloading");
          response = jarl.unwrap(
            await services.http.open(name, {
              signal: controller.signal,
              timeoutMs: options.downloadMs,
            }),
          );
          if (response.status < 200 || response.status >= 300)
            throw new QemuFailed(`ISO ${name} answered ${response.status}`);
          const file = await os.fs.open(partial, "wx");
          const hash = createHash("sha256");
          try {
            while (true) {
              const chunk = jarl.unwrap(await response.read());
              if (chunk === undefined) break;
              await file.writeFile(chunk);
              hash.update(chunk);
              bytes += chunk.length;
            }
            await file.sync();
          } finally {
            await file.close();
          }
          const digest = hash.digest("hex");
          const checksum = await services.http.fetch(
            `${name}.sha256`,
            { signal: controller.signal },
            {
              read: "bytes",
              decode: (value) =>
                jarl.ok(new TextDecoder().decode(value).trim().split(/\s+/)[0]?.toLowerCase()),
            },
          );
          check(controller.signal);
          if (jarl.is_ok(checksum)) {
            const expected = jarl.value(checksum);
            if (expected !== undefined && /^[a-f0-9]{64}$/.test(expected) && expected !== digest)
              throw new QemuFailed(`ISO checksum mismatch: ${name}`);
          } else services.logger.warning(`ISO checksum unavailable: ${name}`);
          await os.fs.rename(partial, target);
          await updateManifest(name, "cached");
          return target;
        } catch (error) {
          await updateManifest(name, "removed").catch((cause) =>
            services.logger.warning(`ISO manifest cleanup failed: ${String(cause)}`),
          );
          throw error;
        } finally {
          clearInterval(heartbeat);
          clearInterval(progress);
          await writing;
          await response?.close();
          await os.fs.rm(partial, { force: true });
          await os.fs.rm(lock, { recursive: true, force: true });
        }
      }, failed);
    return {
      service: "iso",
      pathOf,
      get: (name, signal) =>
        jarl.exec(async () => {
          check(signal);
          check(controller.signal);
          if (!remote(name)) {
            const path = pathOf(name);
            if (!(await present(path))) throw new QemuFailed(`ISO not found: ${path}`);
            return path;
          }
          let flight = flights.get(name);
          if (flight === undefined) {
            flight = download(name);
            flights.set(name, flight);
            void flight.finally(() => flights.delete(name));
          }
          const result = await new Promise<Awaited<Answer<string>>>((settle) => {
            const abort = () =>
              settle(
                jarl.err(
                  jarl.error.is(signal.reason, Async.Aborted)
                    ? signal.reason
                    : new Async.Aborted("ISO waiter aborted"),
                ),
              );
            signal.addEventListener("abort", abort, { once: true });
            void flight.then((answer) => {
              signal.removeEventListener("abort", abort);
              settle(answer);
            });
            if (signal.aborted) abort();
          });
          return jarl.unwrap(result);
        }, failed),
      close: async () => {
        controller.abort(new Async.Aborted("ISO cache shutting down"));
        await Promise.all(flights.values());
      },
    };
  },
);
