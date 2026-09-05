import { createHash } from "node:crypto";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { HttpClient } from "effect/unstable/http";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Qemu from "./qemu.ts";

export type Who = { readonly sessionId: string; readonly agentId: string };

// The cache lives under this home and partial files carry this pid; tests point both elsewhere.
export type HostFacts = { readonly homeDir: string; readonly pid: number };
export const Host = Context.Reference<HostFacts>("@oligarchy/qemu/iso/Host", {
  defaultValue: () => ({ homeDir: Qemu.homeDir, pid: Qemu.pid }),
});

// A downloader refreshes its claim's heartbeat while bytes flow; waiters poll on the same
// cadence and treat three missed beats as a dead downloader.
export const HEARTBEAT_MS = 10_000;
export const POLL_MS = 10_000;
export const STALE_MS = 3 * HEARTBEAT_MS;

export const ManifestEntry = Schema.Union([
  Schema.Struct({ status: Schema.Literal("downloading"), heartbeatAt: Schema.String }),
  Schema.Struct({
    status: Schema.Literal("cached"),
    cachedAt: Schema.String,
    lastUsedAt: Schema.String,
  }),
]).annotate({ identifier: "@oligarchy/qemu/iso/ManifestEntry" });
export type ManifestEntry = typeof ManifestEntry.Type;

export const Manifest = Schema.Record(Schema.String, ManifestEntry).annotate({
  identifier: "@oligarchy/qemu/iso/Manifest",
});
export type Manifest = typeof Manifest.Type;

const ManifestJson = Schema.toCodecJson(Manifest);
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(ManifestJson));
const encodeManifest = Schema.encodeSync(ManifestJson);

const FORBIDDEN = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

// The url as a file name: everything a file system could object to becomes `_`.
export const cacheFileName = (url: string): string =>
  Array.from(url, (char) => (FORBIDDEN.has(char) || char.charCodeAt(0) < 0x20 ? "_" : char)).join(
    "",
  );

const ok = (status: number): boolean => status >= 200 && status < 300;

// The thrown value's own message behind a platform or http failure, else the failure's message.
const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const isoError = (error: unknown): Errors.IsoError =>
  Errors.IsoError.make({ message: `iso: ${detail(error)}`, cause: error });

export type IsoService = {
  // A local path resolved absolute, or a url downloaded once into the cache; either way the
  // path QEMU boots from.
  readonly getIso: (name: string, who: Who) => Effect.Effect<string, Errors.IsoError>;
};

const make: Effect.Effect<
  IsoService,
  never,
  FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | Log.Log
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Release CDNs answer with a redirect; fetch followed up to 20 and so does this.
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.followRedirects(20));
  const log = yield* Log.Log;
  const host = yield* Host;
  const isoDir = path.join(host.homeDir, ".oligarchy", "isos");
  const manifestPath = path.join(isoDir, "manifest.json");
  const manifestPartial = `${manifestPath}.partial-${String(host.pid)}`;
  // Manifest writes are read-modify-write of the whole file; the permit keeps concurrent writers
  // from losing entries, and a failed write releases it so the ones behind are not wedged.
  const manifestLock = yield* Semaphore.make(1);
  const inflight = new Map<string, Deferred.Deferred<string, Errors.IsoError>>();

  const readManifest = Effect.gen(function* () {
    const text = yield* fs.readFileString(manifestPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(undefined),
      ),
    );
    return text === undefined ? {} : yield* decodeManifest(text);
  });

  const updateManifest = (file: string, state: "cached" | "downloading" | "removed") =>
    manifestLock.withPermit(
      Effect.gen(function* () {
        const manifest = yield* readManifest;
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        const entry = manifest[file];
        const next: Record<string, ManifestEntry> = { ...manifest };
        if (state === "removed") {
          delete next[file];
        } else if (state === "downloading") {
          next[file] = { status: "downloading", heartbeatAt: now };
        } else {
          next[file] = {
            status: "cached",
            cachedAt: entry?.status === "cached" ? entry.cachedAt : now,
            lastUsedAt: now,
          };
        }
        yield* fs.writeFileString(
          manifestPartial,
          `${JSON.stringify(encodeManifest(next), null, 2)}\n`,
        );
        yield* fs.rename(manifestPartial, manifestPath);
      }),
    );

  // The sidecar at <url>.sha256 is sha256sum-style ("<hex>  <name>"); its first token is the
  // digest. A 200 whose body is not a digest (a soft-404 page) counts as no sidecar, not as a
  // mismatch, and so does a fetch failure: an optional file must not discard a complete download.
  const publishedSha256 = (url: string): Effect.Effect<Option.Option<string>> =>
    Effect.gen(function* () {
      const response = yield* http.get(`${url}.sha256`);
      if (!ok(response.status)) {
        return Option.none();
      }
      const text = yield* response.text;
      const token = text.trim().split(/\s+/, 1)[0].toLowerCase();
      return /^[0-9a-f]{64}$/.test(token) ? Option.some(token) : Option.none();
    }).pipe(Effect.orElseSucceed(() => Option.none()));

  const download = (url: string, file: string, target: string, who: Who) =>
    Effect.gen(function* () {
      yield* log.info(`iso: downloading ${url} -> ${target}`, who);
      // Renamed into place on success, so a file under the cached name is always a complete
      // download; the pid keeps two proxies on one machine out of each other's partials.
      const partial = `${target}.partial-${String(host.pid)}`;
      let beatAt = yield* Clock.currentTimeMillis;
      const response = yield* http.get(url).pipe(
        Effect.filterOrFail(
          (received) => ok(received.status),
          (received) =>
            Errors.IsoError.make({
              message: `iso: download failed: ${url}: HTTP ${String(received.status)}`,
            }),
        ),
      );
      const hash = createHash("sha256");
      const beat = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (now - beatAt < HEARTBEAT_MS) {
          return;
        }
        beatAt = now;
        // A failed beat only risks a duplicate download elsewhere, never this one.
        yield* updateManifest(file, "downloading").pipe(
          Effect.catch((error) => log.warning(`iso: heartbeat failed: ${detail(error)}`, who)),
        );
      });
      yield* Effect.gen(function* () {
        yield* response.stream.pipe(
          Stream.tap((chunk) =>
            Effect.sync(() => {
              hash.update(chunk);
            }),
          ),
          Stream.tap(() => beat),
          Stream.run(fs.sink(partial)),
        );
        const digest = hash.digest("hex");
        const published = yield* publishedSha256(url);
        yield* Option.match(published, {
          onNone: () =>
            log.warning(`iso: no ${url}.sha256 published; skipping the checksum check`, who),
          onSome: (expected) =>
            expected === digest
              ? Effect.void
              : Errors.IsoError.make({
                  message: `iso: sha256 mismatch: ${url}: published ${expected}, downloaded ${digest}`,
                }),
        });
        yield* fs.rename(partial, target);
        yield* log.info(`iso: cached ${url} -> ${target}`, who);
      }).pipe(Effect.onError(() => Effect.ignore(fs.remove(partial, { force: true }))));
    });

  const downloadCached = (url: string, file: string, who: Who) =>
    Effect.gen(function* () {
      const target = path.join(isoDir, file);
      yield* fs.makeDirectory(isoDir, { recursive: true });
      let waitLogged = false;
      // A live claim is another proxy mid-download: wait for its rename. A stale heartbeat is a
      // dead downloader and gets walked over. Two proxies claiming in the same instant both
      // download — wasteful, still correct, since each streams its own partial and the rename
      // is atomic.
      const claimed = Effect.gen(function* () {
        const entry = (yield* readManifest)[file];
        const now = yield* Clock.currentTimeMillis;
        const live =
          entry?.status === "downloading" && now - Date.parse(entry.heartbeatAt) < STALE_MS;
        if (live && !waitLogged) {
          waitLogged = true;
          yield* log.info(`iso: another download of ${url} is running; waiting for it`, who);
        }
        return live;
      });
      yield* Effect.repeat(claimed, { schedule: Schedule.spaced(POLL_MS), until: (live) => !live });
      // The claim is checked before the file so a download that finishes between the two reads
      // is still seen here and not downloaded again.
      if (yield* fs.exists(target)) {
        yield* log.info(`iso: cache hit ${url} -> ${target}`, who);
        yield* updateManifest(file, "cached");
        return target;
      }
      yield* updateManifest(file, "downloading");
      // Drop the claim so waiters take over right away; if even this write fails, they still
      // recover once the heartbeat goes stale.
      yield* download(url, file, target, who).pipe(
        Effect.onError(() => Effect.ignore(updateManifest(file, "removed"))),
      );
      yield* updateManifest(file, "cached");
      return target;
    });

  const getIso = Effect.fn("Iso.getIso")(function* (name: string, who: Who) {
    if (!Domain.isIsoUrl(name)) {
      const resolved = path.resolve(name);
      const info = yield* fs
        .stat(resolved)
        .pipe(
          Effect.mapError((error) =>
            Errors.IsoError.make({ message: `iso: not found: ${resolved}`, cause: error }),
          ),
        );
      // QEMU's own complaint would land in stdio "ignore", so name a directory iso here.
      if (info.type === "Directory") {
        return yield* Errors.IsoError.make({ message: `iso: is a directory: ${resolved}` });
      }
      return resolved;
    }
    const file = cacheFileName(name);
    const running = inflight.get(file);
    if (running !== undefined) {
      return yield* Deferred.await(running);
    }
    const deferred = yield* Deferred.make<string, Errors.IsoError>();
    inflight.set(file, deferred);
    return yield* downloadCached(name, file, who).pipe(
      Effect.mapError((error) => (error._tag === "IsoError" ? error : isoError(error))),
      Effect.onExit((exit) => Deferred.done(deferred, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          inflight.delete(file);
        }),
      ),
    );
  });

  return { getIso } satisfies IsoService;
});

export class Iso extends Context.Service<Iso>()("@oligarchy/qemu/Iso", { make }) {
  static readonly layer: Layer.Layer<
    Iso,
    never,
    FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | Log.Log
  > = Layer.effect(this)(this.make);
}
