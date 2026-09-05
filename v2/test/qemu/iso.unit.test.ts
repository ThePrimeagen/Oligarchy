import { createHash } from "node:crypto";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Schema, Scope } from "effect";
import { HttpClientError, type HttpClientRequest } from "effect/unstable/http";
import { TestClock } from "effect/testing";
import * as Iso from "../../src/qemu/iso.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLog from "../support/log.ts";

const URL_ISO = "https://iso.example.com/omarchy/omarchy-3.0.iso";
const FILE = "https___iso.example.com_omarchy_omarchy-3.0.iso";
const WHO = { sessionId: "1baaad43-674b-4bdb-88d7-3f18fce50aba", agentId: "OLI-61" };
const PID = 4242;
const BYTES = new TextEncoder().encode("these are the iso bytes");
const DIGEST = createHash("sha256").update(BYTES).digest("hex");
const EPOCH = "1970-01-01T00:00:00.000Z";

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.toCodecJson(Iso.Manifest)),
);

// The proxy's handling of a `Response` body: served in the order the test releases chunks.
type Gate = {
  readonly body: ReadableStream<Uint8Array>;
  readonly push: (chunk: Uint8Array | null) => Effect.Effect<void>;
};

const gate = (): Gate => {
  const buffered: Array<Uint8Array | null> = [];
  const waiting: Array<(chunk: Uint8Array | null) => void> = [];
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) =>
      new Promise<void>((resolve) => {
        const deliver = (chunk: Uint8Array | null) => {
          if (chunk === null) {
            controller.close();
          } else {
            controller.enqueue(chunk);
          }
          resolve();
        };
        const next = buffered.shift();
        if (next === undefined) {
          waiting.push(deliver);
        } else {
          deliver(next);
        }
      }),
  });
  return {
    body,
    push: (chunk) =>
      Effect.sync(() => {
        const deliver = waiting.shift();
        if (deliver === undefined) {
          buffered.push(chunk);
        } else {
          deliver(chunk);
        }
      }),
  };
};

type Routes = {
  readonly iso?: () => Response;
  readonly sidecar?: () => Response;
};

const sidecarFor = (digest: string): Response =>
  new Response(`${digest}  omarchy-3.0.iso\n`, { status: 200 });

const unreachable = (
  request: HttpClientRequest.HttpClientRequest,
): HttpClientError.HttpClientError =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      cause: new Error("getaddrinfo ENOTFOUND iso.example.com"),
      description: "getaddrinfo ENOTFOUND iso.example.com",
    }),
  });

// No request may be made: every call is a defect naming the url.
const refuseHttp: FakeHttp.Respond = (request, url) =>
  Effect.die(`unexpected ${request.method} ${url.toString()}`);

const routes =
  (options: Routes = {}): FakeHttp.Respond =>
  (_request, url) =>
    url.toString().endsWith(".sha256")
      ? (options.sidecar ?? (() => sidecarFor(DIGEST)))()
      : (options.iso ?? (() => new Response(BYTES, { status: 200 })))();

type Fixture = {
  readonly home: string;
  readonly isos: string;
  readonly manifestPath: string;
  readonly cached: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly intercepted: FakeFs.Intercepted;
  readonly log: FakeLog.FakeLog;
  readonly http: FakeHttp.Recorder;
  readonly iso: Iso.IsoService;
  readonly manifest: Effect.Effect<Iso.Manifest>;
  readonly writeManifest: (manifest: Iso.Manifest) => Effect.Effect<void>;
};

const fixture = (respond: FakeHttp.Respond = routes()) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "oligarchy-iso-test-" });
    const isos = path.join(home, ".oligarchy", "isos");
    const manifestPath = path.join(isos, "manifest.json");
    const intercepted = FakeFs.intercepting();
    const log = FakeLog.fakeLog();
    const http = FakeHttp.recordRequests(respond);
    const layer = Iso.Iso.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          intercepted.layer,
          http.layer,
          log.layer,
          Layer.succeed(Iso.Host)({ homeDir: home, pid: PID }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    const iso = yield* Effect.provide(Iso.Iso, layer);
    const manifest = fs.readFileString(manifestPath).pipe(Effect.map(decodeManifest), Effect.orDie);
    const writeManifest = (value: Iso.Manifest) =>
      fs
        .makeDirectory(isos, { recursive: true })
        .pipe(
          Effect.andThen(fs.writeFileString(manifestPath, JSON.stringify(value))),
          Effect.orDie,
        );
    return {
      home,
      isos,
      manifestPath,
      cached: path.join(isos, FILE),
      fs,
      path,
      intercepted,
      log,
      http,
      iso,
      manifest,
      writeManifest,
    } satisfies Fixture;
  });

const manifestWrites = (calls: ReadonlyArray<FakeFs.Call>): ReadonlyArray<string> =>
  calls
    .filter((call) => call.method === "writeFileString" || call.method === "rename")
    .map((call) => {
      const target = call.method === "rename" ? call.args[1] : call.args[0];
      return `${call.method} ${String(target).split("/").at(-1)}`;
    });

// Lets the fiber under test run through real file I/O until `ready` holds.
const until = (ready: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 5_000 && !ready(); attempt++) {
      yield* Effect.yieldNow;
    }
    expect(ready()).toBe(true);
  });

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const withServices = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
): Effect.Effect<A, E, Scope.Scope> => effect.pipe(Effect.provide(NodeServices.layer));

describe("getIso with a local path", () => {
  it.effect("returns an existing file as an absolute path", () =>
    withServices(
      Effect.gen(function* () {
        const { fs, path, home, iso } = yield* fixture(refuseHttp);
        const file = path.join(home, "local.iso");
        yield* fs.writeFileString(file, "x");
        expect(yield* iso.getIso(file, WHO)).toBe(file);
      }),
    ),
  );

  it.effect("resolves a relative name against the working directory", () =>
    withServices(
      Effect.gen(function* () {
        const { path, iso } = yield* fixture();
        const error = yield* Effect.flip(iso.getIso("no-such-file.iso", WHO));
        expect(error).toMatchObject({
          _tag: "IsoError",
          message: `iso: not found: ${path.resolve("no-such-file.iso")}`,
        });
      }),
    ),
  );

  it.effect("refuses a directory", () =>
    withServices(
      Effect.gen(function* () {
        const { home, iso } = yield* fixture();
        const error = yield* Effect.flip(iso.getIso(home, WHO));
        expect(error.message).toBe(`iso: is a directory: ${home}`);
      }),
    ),
  );
});

describe("getIso with a url: cache", () => {
  it.effect("sanitises the url into a file name", () => {
    expect(Iso.cacheFileName(URL_ISO)).toBe(FILE);
    expect(Iso.cacheFileName('a<b>c:d"e/f\\g|h?i*j\u0001k')).toBe("a_b_c_d_e_f_g_h_i_j_k");
    return Effect.void;
  });

  it.effect("returns a cached file, logs the hit and bumps lastUsedAt only", () =>
    withServices(
      Effect.gen(function* () {
        const { fs, iso, log, http, cached, manifest, writeManifest } = yield* fixture(refuseHttp);
        yield* writeManifest({
          [FILE]: {
            status: "cached",
            cachedAt: "2020-01-01T00:00:00.000Z",
            lastUsedAt: "2020-06-01T00:00:00.000Z",
          },
        });
        yield* fs.writeFile(cached, BYTES);
        yield* TestClock.adjust("5 seconds");
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(log.lines).toEqual([
          {
            level: "info",
            text: `iso: cache hit ${URL_ISO} -> ${cached}`,
            sessionId: WHO.sessionId,
            agentId: WHO.agentId,
            skipSentry: false,
            cause: undefined,
          },
        ]);
        expect(yield* manifest).toEqual({
          [FILE]: {
            status: "cached",
            cachedAt: "2020-01-01T00:00:00.000Z",
            lastUsedAt: "1970-01-01T00:00:05.000Z",
          },
        });
        expect(http.requests).toEqual([]);
      }),
    ),
  );

  it.effect("treats a cached file without a manifest entry as a hit", () =>
    withServices(
      Effect.gen(function* () {
        const { fs, path, iso, cached, manifest, isos } = yield* fixture(refuseHttp);
        yield* fs.makeDirectory(isos, { recursive: true });
        yield* fs.writeFile(cached, BYTES);
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(path.join(isos, FILE));
        expect(yield* manifest).toEqual({
          [FILE]: { status: "cached", cachedAt: EPOCH, lastUsedAt: EPOCH },
        });
      }),
    ),
  );
});

describe("getIso with a url: download", () => {
  it.effect("streams to a partial, checks the sidecar, renames and records the manifest", () =>
    withServices(
      Effect.gen(function* () {
        const { fs, iso, log, http, cached, manifest, manifestPath, intercepted } =
          yield* fixture();
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(text(yield* fs.readFile(cached))).toBe(text(BYTES));
        expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          `GET ${URL_ISO}`,
          `GET ${URL_ISO}.sha256`,
        ]);
        expect(log.lines.map((line) => [line.level, line.text])).toEqual([
          ["info", `iso: downloading ${URL_ISO} -> ${cached}`],
          ["info", `iso: cached ${URL_ISO} -> ${cached}`],
        ]);
        expect(log.lines.every((line) => line.agentId === WHO.agentId)).toBe(true);
        expect(yield* manifest).toEqual({
          [FILE]: { status: "cached", cachedAt: EPOCH, lastUsedAt: EPOCH },
        });
        const partial = `${cached}.partial-${String(PID)}`;
        expect(intercepted.calls.filter((call) => call.method === "sink")).toEqual([
          { method: "sink", args: [partial] },
        ]);
        const manifestPartial = `${manifestPath}.partial-${String(PID)}`;
        expect(intercepted.calls.filter((call) => call.method === "rename")).toEqual([
          { method: "rename", args: [manifestPartial, manifestPath] },
          { method: "rename", args: [partial, cached] },
          { method: "rename", args: [manifestPartial, manifestPath] },
        ]);
        expect(yield* fs.exists(partial)).toBe(false);
      }),
    ),
  );

  it.effect("skips the checksum with a warning when no sidecar is published", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, log, cached } = yield* fixture(
          routes({ sidecar: () => new Response("not here", { status: 404 }) }),
        );
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(log.lines.map((line) => [line.level, line.text])).toEqual([
          ["info", `iso: downloading ${URL_ISO} -> ${cached}`],
          ["warning", `iso: no ${URL_ISO}.sha256 published; skipping the checksum check`],
          ["info", `iso: cached ${URL_ISO} -> ${cached}`],
        ]);
      }),
    ),
  );

  it.effect("counts a 200 whose body is not a digest as no sidecar", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, log, cached } = yield* fixture(
          routes({ sidecar: () => new Response("<html>soft 404</html>", { status: 200 }) }),
        );
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(log.lines[1]?.text).toBe(
          `iso: no ${URL_ISO}.sha256 published; skipping the checksum check`,
        );
      }),
    ),
  );

  it.effect("accepts an upper-case digest and ignores the file name after it", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, log, cached } = yield* fixture(
          routes({ sidecar: () => new Response(`${DIGEST.toUpperCase()} *omarchy.iso`) }),
        );
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(log.lines.some((line) => line.level === "warning")).toBe(false);
      }),
    ),
  );

  it.effect("fails on a checksum mismatch, removing the partial and the claim", () =>
    withServices(
      Effect.gen(function* () {
        const { fs, iso, cached, manifest } = yield* fixture(
          routes({ sidecar: () => sidecarFor("a".repeat(64)) }),
        );
        const error = yield* Effect.flip(iso.getIso(URL_ISO, WHO));
        expect(error).toMatchObject({
          _tag: "IsoError",
          message: `iso: sha256 mismatch: ${URL_ISO}: published ${"a".repeat(64)}, downloaded ${DIGEST}`,
        });
        expect(yield* fs.exists(cached)).toBe(false);
        expect(yield* fs.exists(`${cached}.partial-${String(PID)}`)).toBe(false);
        expect(yield* manifest).toEqual({});
      }),
    ),
  );

  it.effect("fails `iso: download failed: <url>: HTTP <status>` and drops the claim", () =>
    withServices(
      Effect.gen(function* () {
        const { fs, iso, cached, manifest, intercepted } = yield* fixture(
          routes({ iso: () => new Response("boom", { status: 500 }) }),
        );
        const error = yield* Effect.flip(iso.getIso(URL_ISO, WHO));
        expect(error.message).toBe(`iso: download failed: ${URL_ISO}: HTTP 500`);
        expect(yield* manifest).toEqual({});
        expect(yield* fs.exists(`${cached}.partial-${String(PID)}`)).toBe(false);
        expect(intercepted.calls.some((call) => call.method === "sink")).toBe(false);
      }),
    ),
  );

  it.effect("fails `iso: <detail>` when the request itself fails, dropping the claim", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, manifest } = yield* fixture((request) => Effect.fail(unreachable(request)));
        const error = yield* Effect.flip(iso.getIso(URL_ISO, WHO));
        expect(error).toMatchObject({
          _tag: "IsoError",
          message: "iso: getaddrinfo ENOTFOUND iso.example.com",
        });
        expect(yield* manifest).toEqual({});
      }),
    ),
  );

  it.effect("counts an unreachable sidecar as none published", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, log, cached } = yield* fixture((request, url) =>
          url.toString().endsWith(".sha256")
            ? Effect.fail(unreachable(request))
            : new Response(BYTES, { status: 200 }),
        );
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(log.lines[1]?.text).toBe(
          `iso: no ${URL_ISO}.sha256 published; skipping the checksum check`,
        );
      }),
    ),
  );

  it.effect("shares one download between concurrent requests for the same url", () =>
    withServices(
      Effect.gen(function* () {
        const body = gate();
        const { iso, http, cached } = yield* fixture(
          routes({ iso: () => new Response(body.body, { status: 200 }) }),
        );
        const first = yield* Effect.forkChild(iso.getIso(URL_ISO, WHO));
        const second = yield* Effect.forkChild(iso.getIso(URL_ISO, { ...WHO, agentId: "OLI-62" }));
        yield* Effect.yieldNow;
        yield* body.push(BYTES);
        yield* body.push(null);
        expect(yield* Fiber.join(first)).toBe(cached);
        expect(yield* Fiber.join(second)).toBe(cached);
        expect(http.requests.filter((request) => request.url === URL_ISO)).toHaveLength(1);
      }),
    ),
  );
});

describe("getIso with a url: claims", () => {
  it.effect(
    "waits for another proxy's live download, logging once, and polls every 10 seconds",
    () =>
      withServices(
        Effect.gen(function* () {
          const { fs, iso, log, http, cached, writeManifest } = yield* fixture(refuseHttp);
          yield* writeManifest({ [FILE]: { status: "downloading", heartbeatAt: EPOCH } });
          const fiber = yield* Effect.forkChild(iso.getIso(URL_ISO, WHO));
          yield* until(() => log.lines.length > 0);
          expect(log.lines.map((line) => line.text)).toEqual([
            `iso: another download of ${URL_ISO} is running; waiting for it`,
          ]);
          yield* TestClock.adjust(Iso.POLL_MS);
          expect(fiber.pollUnsafe()).toBeUndefined();
          expect(log.lines).toHaveLength(1);
          // The other proxy finishes: file in place, claim replaced by a cached entry.
          yield* fs.writeFile(cached, BYTES);
          yield* writeManifest({
            [FILE]: { status: "cached", cachedAt: EPOCH, lastUsedAt: EPOCH },
          });
          yield* TestClock.adjust(Iso.POLL_MS);
          expect(yield* Fiber.join(fiber)).toBe(cached);
          expect(log.lines.map((line) => line.text)).toEqual([
            `iso: another download of ${URL_ISO} is running; waiting for it`,
            `iso: cache hit ${URL_ISO} -> ${cached}`,
          ]);
          expect(http.requests).toEqual([]);
        }),
      ),
  );

  it.effect("takes over a claim whose heartbeat is 30 seconds stale", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, log, cached, writeManifest } = yield* fixture();
        yield* writeManifest({ [FILE]: { status: "downloading", heartbeatAt: EPOCH } });
        yield* TestClock.adjust(Iso.STALE_MS);
        expect(yield* iso.getIso(URL_ISO, WHO)).toBe(cached);
        expect(log.lines[0]?.text).toBe(`iso: downloading ${URL_ISO} -> ${cached}`);
      }),
    ),
  );

  it.effect("refreshes the heartbeat while bytes flow", () =>
    withServices(
      Effect.gen(function* () {
        const body = gate();
        const requested = yield* Deferred.make<void>();
        const { iso, cached, manifest, manifestPath, intercepted } = yield* fixture((_, url) => {
          if (url.toString().endsWith(".sha256")) {
            return sidecarFor(DIGEST);
          }
          Deferred.doneUnsafe(requested, Effect.void);
          return new Response(body.body, { status: 200 });
        });
        const fiber = yield* Effect.forkChild(iso.getIso(URL_ISO, WHO));
        yield* Deferred.await(requested);
        expect(yield* manifest).toEqual({
          [FILE]: { status: "downloading", heartbeatAt: EPOCH },
        });
        yield* TestClock.adjust(Iso.HEARTBEAT_MS);
        const beat = yield* Effect.forkChild(
          intercepted.next((call) => call.method === "rename" && call.args[1] === manifestPath),
        );
        yield* body.push(BYTES.slice(0, 5));
        yield* Fiber.join(beat);
        expect(yield* manifest).toEqual({
          [FILE]: { status: "downloading", heartbeatAt: "1970-01-01T00:00:10.000Z" },
        });
        // A second chunk within the same 10 seconds does not beat again.
        const extra = yield* Effect.forkChild(
          intercepted.next((call) => call.method === "writeFileString"),
        );
        yield* body.push(BYTES.slice(5, 8));
        yield* body.push(BYTES.slice(8));
        yield* body.push(null);
        expect(yield* Fiber.join(fiber)).toBe(cached);
        // The next manifest write is the final `cached` entry, not a beat.
        const call = yield* Fiber.join(extra);
        expect(String(call.args[1])).toContain('"status": "cached"');
      }),
    ),
  );

  it.effect("only warns when a heartbeat write fails", () =>
    withServices(
      Effect.gen(function* () {
        const body = gate();
        const requested = yield* Deferred.make<void>();
        const { iso, log, cached, manifestPath, intercepted } = yield* fixture((_, url) => {
          if (url.toString().endsWith(".sha256")) {
            return sidecarFor(DIGEST);
          }
          Deferred.doneUnsafe(requested, Effect.void);
          return new Response(body.body, { status: 200 });
        });
        const fiber = yield* Effect.forkChild(iso.getIso(URL_ISO, WHO));
        yield* Deferred.await(requested);
        yield* TestClock.adjust(Iso.HEARTBEAT_MS);
        const partial = `${manifestPath}.partial-${String(PID)}`;
        intercepted.failing.add(partial);
        const beat = yield* Effect.forkChild(
          intercepted.next((call) => call.method === "writeFileString" && call.args[0] === partial),
        );
        yield* body.push(BYTES.slice(0, 5));
        yield* Fiber.join(beat);
        yield* Effect.yieldNow;
        intercepted.failing.clear();
        yield* body.push(BYTES.slice(5));
        yield* body.push(null);
        expect(yield* Fiber.join(fiber)).toBe(cached);
        expect(log.lines.map((line) => [line.level, line.text.split(":")[0]])).toEqual([
          ["info", "iso"],
          ["warning", "iso"],
          ["info", "iso"],
        ]);
        expect(log.lines[1]?.text).toMatch(/^iso: heartbeat failed: EACCES/);
      }),
    ),
  );

  it.effect("writes the manifest atomically and serialises concurrent updates", () =>
    withServices(
      Effect.gen(function* () {
        const other = "https://iso.example.com/other.iso";
        const { fs, iso, path, isos, intercepted } = yield* fixture(refuseHttp);
        yield* fs.makeDirectory(isos, { recursive: true });
        yield* fs.writeFile(path.join(isos, FILE), BYTES);
        yield* fs.writeFile(path.join(isos, Iso.cacheFileName(other)), BYTES);
        yield* Effect.all([iso.getIso(URL_ISO, WHO), iso.getIso(other, WHO)], {
          concurrency: "unbounded",
        });
        expect(manifestWrites(intercepted.calls)).toEqual([
          `writeFileString manifest.json.partial-${String(PID)}`,
          "rename manifest.json",
          `writeFileString manifest.json.partial-${String(PID)}`,
          "rename manifest.json",
        ]);
        expect(yield* fs.readFileString(path.join(isos, "manifest.json"))).toMatch(/^\{\n  "/);
      }),
    ),
  );

  it.effect("fails a start when the claim cannot be written", () =>
    withServices(
      Effect.gen(function* () {
        const { iso, manifestPath, intercepted, http } = yield* fixture();
        intercepted.failing.add(`${manifestPath}.partial-${String(PID)}`);
        const error = yield* Effect.flip(iso.getIso(URL_ISO, WHO));
        expect(error._tag).toBe("IsoError");
        expect(error.message).toMatch(/^iso: EACCES/);
        expect(http.requests).toEqual([]);
      }),
    ),
  );
});
