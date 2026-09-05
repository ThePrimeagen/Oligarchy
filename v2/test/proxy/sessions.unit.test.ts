import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  MutableRef,
  Option,
  Path,
  PlatformError,
  Ref,
  Schema,
  Stream,
  Tracer,
} from "effect";
import { TestClock } from "effect/testing";
import * as Sessions from "../../src/proxy/sessions.ts";
import * as Log from "../../src/observability/log.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeQemu from "../support/fake-qemu.ts";
import * as Stores from "../support/stores.ts";
import * as Recording from "../support/tracer.ts";

const AGENT = "OLI-61";
const OTHER_AGENT = "OLI-62";
const ISO = "/isos/omarchy.iso";
const URL_ISO = "https://example.com/omarchy.iso";
const DISK = "/disks/omarchy.qcow2";
const UNKNOWN_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const SERIAL = new TextEncoder().encode("boot log\n");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const fileInfo: FileSystem.File.Info = {
  type: "File",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0o644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
};

const notFound = (method: string, path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    description: "No such file or directory",
    pathOrDescriptor: path,
  });

const denied = (method: string, path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method,
    description: "Permission denied",
    pathOrDescriptor: path,
  });

type Files = Map<string, Effect.Effect<Uint8Array, PlatformError.PlatformError>>;

type Options = {
  readonly script?: FakeQemu.Script;
  readonly resolveIso?: FakeQemu.Resolve;
  readonly sessionStore?: Parameters<typeof Stores.fakeSessionStore>[0];
  readonly actionStore?: Parameters<typeof Stores.fakeActionStore>[0];
  readonly log?: Layer.Layer<Log.Log>;
  readonly shutdown?: Sessions.Shutdown;
};

const harness = (options: Options = {}) => {
  const sessions = Stores.fakeSessionStore(options.sessionStore);
  const actions = Stores.fakeActionStore(options.actionStore);
  const log = FakeLog.fakeLog();
  const tracer = Recording.recording();
  const qemu = FakeQemu.fakeQemu(options.script);
  const iso = FakeQemu.fakeIso(options.resolveIso);
  const files: Files = new Map();
  const fsCalls: Array<string> = [];
  const fs = FileSystem.layerNoop({
    stat: (path) =>
      Effect.suspend(() => {
        fsCalls.push(`stat ${path}`);
        return files.has(path) ? Effect.succeed(fileInfo) : Effect.fail(notFound("stat", path));
      }),
    readFile: (path) =>
      Effect.suspend(() => {
        fsCalls.push(`readFile ${path}`);
        return files.get(path) ?? Effect.fail(notFound("readFile", path));
      }),
  });
  const shutdown =
    options.shutdown === undefined
      ? Layer.empty
      : Layer.succeed(Sessions.Shutdown)(options.shutdown);
  const layer = Sessions.Sessions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        qemu.layer,
        iso.layer,
        FakeQemu.fakeStats,
        sessions.layer,
        actions.layer,
        options.log ?? log.layer,
        fs,
        Path.layer,
        shutdown,
      ),
    ),
  );
  // The recording tracer is provided beneath the service and to the caller: spans are made in
  // whichever fiber calls a method.
  const run = <A, E>(body: Effect.Effect<A, E, Sessions.Sessions>): Effect.Effect<A, E> =>
    body.pipe(Effect.provide(layer.pipe(Layer.provideMerge(tracer.layer))));
  return { sessions, actions, log, tracer, qemu, iso, files, fsCalls, run };
};

type Harness = ReturnType<typeof harness>;

const startBody = (iso = ISO, agent = AGENT, disk?: string) =>
  disk === undefined
    ? Contract.StartBody.make({ iso, agent })
    : Contract.StartBody.make({ iso, agent, disk });

const start = (agent = AGENT, iso = ISO) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    const id = yield* sessions.start(startBody(iso, agent), "none", false);
    const live = yield* sessions.lookup(id, agent);
    return { sessions, id, live };
  });

const serialPath = (h: Harness, id: string): string => `${h.qemu.sessionDir(id)}/serial.log`;

const spanNamed = (h: Harness, name: string): Tracer.NativeSpan | undefined =>
  h.tracer.spans.find((span) => span.name === name);

// "ok" for a span ended successfully, the failure value for one ended in failure, undefined while open.
const endedWith = (span: Tracer.NativeSpan | undefined): unknown => {
  if (span === undefined || span.status._tag !== "Ended") {
    return undefined;
  }
  return Exit.isSuccess(span.status.exit) ? "ok" : Cause.squash(span.status.exit.cause);
};

const texts = (h: Harness): ReadonlyArray<string> => FakeLog.texts(h.log);

const line = (h: Harness, prefix: string): FakeLog.Line | undefined =>
  h.log.lines.find((entry) => entry.text.startsWith(prefix));

const collect = (stream: Stream.Stream<Domain.FollowEvent>, n: number) =>
  Stream.runCollect(Stream.take(stream, n));

// How many machines the proxy holds, as /stats reports it.
const qemus = (sessions: { readonly stats: Effect.Effect<Contract.Stats> }) =>
  Effect.map(sessions.stats, (stats) => stats.qemus);

const failure = (operation: string, detail: string): Errors.DatabaseError =>
  Errors.DatabaseError.make({
    operation,
    message: `Failed query: ${operation}`,
    cause: new Error(detail),
  });

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe("start", () => {
  it.effect(
    "inserts the row before the download, stats the disk first, prepares the machine and registers right before boot",
    () =>
      Effect.gen(function* () {
        const order: Array<string> = [];
        const rowsAtDownload: Array<string> = [];
        const h = harness({
          resolveIso: (call) =>
            Effect.sync(() => {
              order.push("getIso");
              rowsAtDownload.push(...h.sessions.sessions.map((row) => row.status));
              return `/cache/${call.name.split("/").at(-1) ?? ""}`;
            }),
          sessionStore: {
            registerAgent: () =>
              Effect.sync(() => {
                order.push("registerAgent");
              }),
          },
          script: {
            prepare: () =>
              Effect.sync(() => {
                order.push("prepare");
              }),
            boot: (input) =>
              Effect.sync(() => {
                order.push(`start ${input.iso}`);
              }),
          },
        });
        h.files.set(DISK, Effect.succeed(new Uint8Array()));
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const id = yield* sessions.start(startBody(URL_ISO, AGENT, DISK), "gtk", true);
            expect(Domain.isSessionId(id)).toBe(true);
            expect(h.fsCalls).toEqual([`stat ${DISK}`]);
            expect(order).toEqual([
              "getIso",
              "prepare",
              "registerAgent",
              "start /cache/omarchy.iso",
            ]);
            expect(rowsAtDownload).toEqual(["downloading"]);
            expect(h.iso.calls).toEqual([{ name: URL_ISO, sessionId: id, agentId: AGENT }]);
            expect(h.sessions.sessions).toMatchObject([
              { id, status: "running", config: { iso: URL_ISO, disk: DISK }, reason: null },
            ]);
            expect(h.qemu.calls).toEqual([
              { _tag: "prepare", id, disk: DISK },
              {
                _tag: "start",
                id,
                iso: "/cache/omarchy.iso",
                diskPath: DISK,
                display: "gtk",
                automation: true,
              },
            ]);
            expect(texts(h)).toEqual([
              `starting; iso ${URL_ISO}, disk ${DISK}`,
              "running; started in 0ms",
            ]);
            expect(h.log.lines[0]).toMatchObject({ level: "info", sessionId: id, agentId: AGENT });
            const span = spanNamed(h, "QEMU session");
            expect(span?.attributes.get("session_id")).toBe(id);
            expect(span?.attributes.get("agent_id")).toBe(AGENT);
            expect(span?.attributes.get("sentry.op")).toBe("qemu.session");
            expect(endedWith(span)).toBeUndefined();
            // The handshake's qmp_capabilities is recorded as an action on the new agent run.
            expect(h.actions.actions).toMatchObject([
              {
                sessionId: id,
                agentId: AGENT,
                request: { execute: "qmp_capabilities" },
                state: "completed",
                response: FakeQemu.GREETING,
              },
            ]);
            expect(yield* qemus(sessions)).toBe(1);
          }),
        );
      }),
  );

  it.effect("a local iso path inserts the row as running and logs without a disk", () =>
    Effect.gen(function* () {
      const rowsAtDownload: Array<string> = [];
      const h = harness({
        resolveIso: (call) =>
          Effect.sync(() => {
            rowsAtDownload.push(...h.sessions.sessions.map((row) => row.status));
            return call.name;
          }),
      });
      yield* h.run(
        Effect.gen(function* () {
          const { id } = yield* start();
          expect(rowsAtDownload).toEqual(["running"]);
          expect(h.sessions.sessions[0]?.config).toEqual({ iso: ISO });
          expect(h.sessions.agentRuns).toMatchObject([{ agentId: AGENT, sessionId: id }]);
          expect(texts(h)).toEqual([`starting; iso ${ISO}`, "running; started in 0ms"]);
          expect(h.fsCalls).toEqual([]);
        }),
      );
    }),
  );

  it.effect("a missing disk fails before the download and before the agent is registered", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(
            sessions.start(startBody(URL_ISO, AGENT, DISK), "none", false),
          );
          expect(error).toMatchObject({
            _tag: "StartFailed",
            message: `qemu: disk not found: ${DISK}`,
            agentId: AGENT,
          });
          expect(h.iso.calls).toEqual([]);
          expect(h.sessions.agentRuns).toEqual([]);
          expect(h.qemu.calls).toEqual([]);
          expect(h.sessions.sessions).toMatchObject([
            { status: "failed", reason: `qemu: disk not found: ${DISK}` },
          ]);
        }),
      );
    }),
  );

  it.effect("a failing qemu-img leaves the agent unregistered and the row failed", () =>
    Effect.gen(function* () {
      let prepares = 0;
      const h = harness({
        script: {
          prepare: () =>
            Effect.suspend(() =>
              ++prepares === 1
                ? Effect.fail(Errors.QemuStartError.make({ message: "qemu-img create exited 1" }))
                : Effect.void,
            ),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(sessions.start(startBody(URL_ISO), "none", false));
          expect(error).toMatchObject({
            _tag: "StartFailed",
            message: "qemu-img create exited 1",
            agentId: AGENT,
          });
          expect(h.iso.calls).toHaveLength(1);
          expect(h.sessions.agentRuns).toEqual([]);
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare"]);
          expect(h.sessions.sessions).toMatchObject([
            { status: "failed", reason: "qemu-img create exited 1" },
          ]);
          expect(h.log.released).toEqual([AGENT]);
          // The registration was never spent: the same agent boots on its next try.
          const id = yield* sessions.start(startBody(), "none", false);
          expect(h.sessions.agentRuns).toMatchObject([{ agentId: AGENT, sessionId: id }]);
          expect(yield* qemus(sessions)).toBe(1);
        }),
      );
    }),
  );

  it.effect(
    "a boot failure stops the machine, ends the row failed with the detail and fails StartFailed",
    () =>
      Effect.gen(function* () {
        const h = harness({
          script: {
            boot: () =>
              Effect.fail(
                Errors.QemuStartError.make({ message: "qemu: handshake timeout: kvm: disabled" }),
              ),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const error = yield* Effect.flip(sessions.start(startBody(), "none", false));
            expect(error._tag).toBe("StartFailed");
            if (error._tag !== "StartFailed") {
              return;
            }
            const id = error.sessionId;
            expect(error.message).toBe("qemu: handshake timeout: kvm: disabled");
            expect(error.agentId).toBe(AGENT);
            expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start", "stop"]);
            expect(h.sessions.sessions).toMatchObject([
              { id, status: "failed", reason: "qemu: handshake timeout: kvm: disabled" },
            ]);
            expect(endedWith(spanNamed(h, "QEMU session"))).toBe("internal_error");
            expect(spanNamed(h, "QEMU session")?.attributes.get("session_status")).toBe("failed");
            expect(h.log.released).toEqual([AGENT]);
            expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
              _tag: "UnknownSession",
              id,
            });
            expect(yield* Effect.flip(sessions.follow(id))).toMatchObject({
              _tag: "Conflict",
              message: `session "${id}" has already completed (failed)`,
            });
            expect(yield* qemus(sessions)).toBe(0);
            expect(texts(h)).toEqual([`starting; iso ${ISO}`]);
          }),
        );
      }),
  );

  it.effect(
    "a failed start whose record cannot be closed logs that too and still fails StartFailed",
    () =>
      Effect.gen(function* () {
        const h = harness({
          script: {
            boot: () => Effect.fail(Errors.QemuStartError.make({ message: "qemu: exited 1" })),
          },
          sessionStore: {
            endSession: () =>
              Effect.fail(
                Errors.DatabaseError.make({
                  operation: "endSession",
                  message: "Failed query: update sessions",
                }),
              ),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const error = yield* Effect.flip(sessions.start(startBody(), "none", false));
            expect(error).toMatchObject({ _tag: "StartFailed", message: "qemu: exited 1" });
            const logged = line(h, "db: recording a failed start failed too:");
            expect(logged).toMatchObject({
              level: "error",
              text: "db: recording a failed start failed too: Failed query: update sessions",
              agentId: AGENT,
            });
            expect(logged?.cause).toMatchObject({ _tag: "DatabaseError" });
          }),
        );
      }),
  );

  it.effect("a refused session insert fails Internal and closes the session span", () =>
    Effect.gen(function* () {
      const h = harness({
        sessionStore: {
          insertSession: () => Effect.fail(failure("insertSession", "ECONNREFUSED")),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(sessions.start(startBody(), "none", false));
          expect(error).toMatchObject({
            _tag: "Internal",
            message: "internal error",
            agentId: AGENT,
          });
          expect(h.iso.calls).toEqual([]);
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("internal_error");
          expect(texts(h)).toEqual([]);
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// lookup
// ---------------------------------------------------------------------------

describe("lookup", () => {
  it.effect("refuses an empty id, an unknown id and another agent's session", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id } = yield* start();
          expect(yield* Effect.flip(sessions.lookup("", AGENT))).toMatchObject({
            _tag: "BadRequest",
            message: "session id is required",
            agentId: AGENT,
          });
          expect(yield* Effect.flip(sessions.lookup(UNKNOWN_ID, AGENT))).toMatchObject({
            _tag: "UnknownSession",
            id: UNKNOWN_ID,
            message: `unknown session "${UNKNOWN_ID}"`,
            agentId: AGENT,
          });
          expect(yield* Effect.flip(sessions.lookup(id, OTHER_AGENT))).toMatchObject({
            _tag: "Forbidden",
            message: `agent "${OTHER_AGENT}" does not own session "${id}"`,
            sessionId: id,
            agentId: OTHER_AGENT,
          });
        }),
      );
    }),
  );

  it.effect("resets lastCommandAt even when the work that follows fails", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          expect(yield* Ref.get(live.lastCommandAt)).toBe(0);
          yield* TestClock.adjust("5 minutes");
          const again = yield* sessions.lookup(id, AGENT);
          expect(again).toBe(live);
          const error = yield* Effect.flip(sessions.sendKeys(again, "<BOGUS>", undefined));
          expect(error._tag).toBe("BadRequest");
          expect(yield* Ref.get(live.lastCommandAt)).toBe(300_000);
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------

describe("image", () => {
  it.effect("returns the png, records action and image together and tells followers first", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          const { png, imageId } = yield* sessions.image(live);
          expect(png).toBe(FakeQemu.PNG);
          expect(Domain.isSessionId(imageId)).toBe(true);
          const url = Contract.StoredImageUrl(imageId);
          expect(h.actions.actions[1]).toMatchObject({
            id: 2,
            request: { execute: "screendump", arguments: { format: "png" } },
            state: "completed",
          });
          expect(h.actions.images).toEqual([{ id: imageId, actionId: 2, data: FakeQemu.PNG }]);
          const png64 = Buffer.from(FakeQemu.PNG).toString("base64");
          expect(yield* Ref.get(live.image)).toEqual(Option.some({ id: imageId, png: png64 }));
          expect(yield* collect(events, 4)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "get-image", state: "running" },
            { type: "image", id: imageId, png: png64 },
            { type: "action", id: 1, state: "completed" },
          ]);
          const action = spanNamed(h, "QMP screendump");
          expect(action?.attributes.get("image_url")).toBe(url);
          expect(action?.attributes.get("action_state")).toBe("completed");
          expect(action?.attributes.get("qemu.command")).toBe("screendump");
          expect(endedWith(action)).toBe("ok");
          expect(Option.getOrUndefined(action?.parent ?? Option.none())?.spanId).toBe(
            spanNamed(h, "QEMU session")?.spanId,
          );
          expect(line(h, "image;")).toMatchObject({
            level: "info",
            text: `image; ${String(FakeQemu.PNG.length)} bytes in 0ms; ${url}`,
            sessionId: id,
            agentId: AGENT,
          });
        }),
      );
    }),
  );

  it.effect("a second image replaces the one followers are handed", () =>
    Effect.gen(function* () {
      const second = new Uint8Array([1, 2, 3]);
      const shots = [FakeQemu.PNG, second];
      const h = harness({ script: { screendump: () => Effect.succeed(shots.shift() ?? second) } });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* sessions.image(live);
          const { imageId } = yield* sessions.image(live);
          const events = yield* sessions.follow(id);
          expect(yield* collect(events, 2)).toEqual([
            { type: "session", status: "running" },
            { type: "image", id: imageId, png: Buffer.from(second).toString("base64") },
          ]);
        }),
      );
    }),
  );

  it.effect(
    "a failed exchange closes the action failed without an image and fails ExchangeFailed",
    () =>
      Effect.gen(function* () {
        const raw: Domain.QmpFailure = {
          error: { class: "GenericError", desc: "no console available" },
          id: 2,
        };
        const h = harness({
          script: {
            screendump: () =>
              Effect.fail(
                Errors.QmpError.make({
                  command: "screendump",
                  class: "GenericError",
                  desc: "no console available",
                  raw,
                }),
              ),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            const events = yield* sessions.follow(id);
            const error = yield* Effect.flip(sessions.image(live));
            expect(error).toMatchObject({
              _tag: "ExchangeFailed",
              message: "GenericError: no console available",
              sessionId: id,
              agentId: AGENT,
            });
            expect(h.actions.actions[1]).toMatchObject({ state: "failed", response: raw });
            expect(h.actions.images).toEqual([]);
            expect(yield* Ref.get(live.image)).toEqual(Option.none());
            expect(yield* collect(events, 3)).toEqual([
              { type: "session", status: "running" },
              { type: "action", id: 1, name: "get-image", state: "running" },
              { type: "action", id: 1, state: "failed" },
            ]);
            const action = spanNamed(h, "QMP screendump");
            expect(action?.attributes.get("action_state")).toBe("failed");
            expect(action?.attributes.has("image_url")).toBe(false);
            expect(endedWith(action)).toBe("internal_error");
            expect(line(h, "image;")).toBeUndefined();
          }),
        );
      }),
  );

  it.effect("a completed screendump whose image write fails leaves the action open", () =>
    Effect.gen(function* () {
      const closes: Array<{ id: number; image: boolean }> = [];
      const h = harness({
        actionStore: {
          finishAction: (id, _outcome, image) =>
            Effect.suspend(() => {
              closes.push({ id, image: image !== undefined });
              return image === undefined
                ? Effect.void
                : Effect.fail(failure("finishAction", "connect ECONNREFUSED"));
            }),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const error = yield* Effect.flip(sessions.image(live));
          expect(error).toMatchObject({ _tag: "Internal", sessionId: id, agentId: AGENT });
          expect(closes).toEqual([
            { id: 1, image: false },
            { id: 2, image: true },
          ]);
          expect(yield* Ref.get(live.image)).toEqual(Option.none());
          expect(spanNamed(h, "QMP screendump")?.attributes.get("action_state")).toBe("completed");
        }),
      );
    }),
  );

  it.effect("a screendump file that cannot be read fails Internal and leaves the action open", () =>
    Effect.gen(function* () {
      const h = harness({
        script: { screendump: () => Effect.fail(denied("readFile", "/tmp/x/image-1.png")) },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, live } = yield* start();
          const error = yield* Effect.flip(sessions.image(live));
          expect(error._tag).toBe("Internal");
          // The exchange completed, so only an image write may close it; none happened.
          expect(h.actions.actions[1]?.state).toBeNull();
          expect(h.actions.images).toEqual([]);
          expect(spanNamed(h, "QMP screendump")?.attributes.get("action_state")).toBe("completed");
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// serial
// ---------------------------------------------------------------------------

describe("serial", () => {
  it.effect("reads the console file and logs its size", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          h.files.set(serialPath(h, id), Effect.succeed(SERIAL));
          const events = yield* sessions.follow(id);
          expect(yield* sessions.serial(live)).toBe(SERIAL);
          expect(line(h, "serial;")).toMatchObject({
            text: `serial; ${String(SERIAL.length)} bytes in 0ms`,
            sessionId: id,
            agentId: AGENT,
          });
          expect(yield* collect(events, 3)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "get-serial", state: "running" },
            { type: "action", id: 1, state: "completed" },
          ]);
          expect(h.actions.actions).toHaveLength(1);
        }),
      );
    }),
  );

  it.effect("a console that cannot be read fails Internal and fails the follow action", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          h.files.set(serialPath(h, id), Effect.fail(denied("readFile", serialPath(h, id))));
          const events = yield* sessions.follow(id);
          const error = yield* Effect.flip(sessions.serial(live));
          expect(error).toMatchObject({ _tag: "Internal", sessionId: id, agentId: AGENT });
          expect(yield* collect(events, 3)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "get-serial", state: "running" },
            { type: "action", id: 1, state: "failed" },
          ]);
          expect(line(h, "serial;")).toBeUndefined();
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// sendKeys
// ---------------------------------------------------------------------------

describe("sendKeys", () => {
  it.effect("refuses a bad key string and an oversized one before any exchange", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          expect(yield* Effect.flip(sessions.sendKeys(live, "<BOGUS>", undefined))).toMatchObject({
            _tag: "BadRequest",
            message: 'qemu: unknown key "BOGUS"',
            sessionId: id,
            agentId: AGENT,
          });
          expect(yield* Effect.flip(sessions.sendKeys(live, "a", "utf16"))).toMatchObject({
            _tag: "BadRequest",
            message: 'qemu: unknown key encoding "utf16"',
          });
          expect(
            yield* Effect.flip(sessions.sendKeys(live, "a".repeat(1001), "oligarchy")),
          ).toMatchObject({
            _tag: "BadRequest",
            message: "send-keys: at most 1000 keys per request",
            sessionId: id,
            agentId: AGENT,
          });
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start"]);
          expect(h.actions.actions).toHaveLength(1);
          yield* sessions.sendKeys(live, "ok", undefined);
          expect(yield* collect(events, 3)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "send-keys", state: "running" },
            { type: "action", id: 1, state: "completed" },
          ]);
        }),
      );
    }),
  );

  it.effect(
    "sends the chords, records one action each and numbers follow actions per session",
    () =>
      Effect.gen(function* () {
        const h = harness();
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            const other = yield* start(OTHER_AGENT);
            const events = yield* sessions.follow(id);
            yield* sessions.sendKeys(live, "hello", undefined);
            yield* sessions.sendKeys(live, "hi", "oligarchy");
            yield* sessions.sendKeys(other.live, "x", undefined);
            expect(h.qemu.calls.filter((call) => call._tag === "sendKeys")).toEqual([
              { _tag: "sendKeys", id, chords: [["h"], ["e"], ["l"], ["l"], ["o"]] },
              { _tag: "sendKeys", id, chords: [["h"], ["i"]] },
              { _tag: "sendKeys", id: other.id, chords: [["x"]] },
            ]);
            expect(texts(h).filter((text) => text.startsWith("sent"))).toEqual([
              "sent 5 chords in 0ms",
              "sent 2 chords in 0ms",
              "sent 1 chords in 0ms",
            ]);
            expect(
              h.actions.actions.filter((row) => row.sessionId === id && row.state === "completed"),
            ).toHaveLength(1 + 5 + 2);
            expect(yield* collect(events, 5)).toEqual([
              { type: "session", status: "running" },
              { type: "action", id: 1, name: "send-keys", state: "running" },
              { type: "action", id: 1, state: "completed" },
              { type: "action", id: 2, name: "send-keys", state: "running" },
              { type: "action", id: 2, state: "completed" },
            ]);
            expect(h.tracer.spans.filter((span) => span.name === "QMP send-key")).toHaveLength(8);
          }),
        );
      }),
  );

  it.effect("a failing exchange fails ExchangeFailed and closes that action failed", () =>
    Effect.gen(function* () {
      const h = harness({
        script: {
          sendKey: (chord) =>
            chord[0] === "b"
              ? Effect.fail(Errors.QmpTimeout.make({ command: "send-key" }))
              : Effect.void,
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const error = yield* Effect.flip(sessions.sendKeys(live, "abc", undefined));
          expect(error).toMatchObject({
            _tag: "ExchangeFailed",
            message: "qemu: send-key timed out",
            sessionId: id,
            agentId: AGENT,
          });
          expect(h.actions.actions.slice(1)).toMatchObject([
            { state: "completed" },
            { state: "failed", response: "qemu: send-key timed out" },
          ]);
          expect(line(h, "sent")).toBeUndefined();
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// sendMouse
// ---------------------------------------------------------------------------

describe("sendMouse", () => {
  const mouse = (id: string, x: number, y: number, button?: Domain.MouseButton, clicks?: number) =>
    Contract.SendMouseBody.make(
      Object.assign(
        { id, x, y, agent: AGENT },
        button === undefined ? undefined : { button },
        clicks === undefined ? undefined : { clicks },
      ),
    );

  it.effect("refuses coordinates outside 0..1 and clicks outside 1..100 before any exchange", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const outside: ReadonlyArray<readonly [number, number]> = [
            [1.5, 0.5],
            [-0.1, 0.5],
            [0.5, 2],
          ];
          for (const [x, y] of outside) {
            expect(yield* Effect.flip(sessions.sendMouse(live, mouse(id, x, y)))).toMatchObject({
              _tag: "BadRequest",
              message: "mouse: x and y must be in 0..1",
              sessionId: id,
              agentId: AGENT,
            });
          }
          for (const clicks of [0, 101, 1.5]) {
            expect(
              yield* Effect.flip(sessions.sendMouse(live, mouse(id, 0.5, 0.5, "left", clicks))),
            ).toMatchObject({
              _tag: "BadRequest",
              message: "mouse: clicks must be an integer in 1..100",
            });
          }
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start"]);
        }),
      );
    }),
  );

  it.effect("moves, clicks and logs the gesture", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          yield* sessions.sendMouse(live, mouse(id, 0.5, 0.5, "left", 2));
          yield* sessions.sendMouse(live, mouse(id, 0.25, 0.75));
          yield* sessions.sendMouse(live, mouse(id, 0, 1, "right", 1));
          expect(h.qemu.calls.filter((call) => call._tag === "sendMouse")).toEqual([
            { _tag: "sendMouse", id, input: { x: 0.5, y: 0.5, button: "left", clicks: 2 } },
            { _tag: "sendMouse", id, input: { x: 0.25, y: 0.75 } },
            { _tag: "sendMouse", id, input: { x: 0, y: 1, button: "right", clicks: 1 } },
          ]);
          expect(texts(h).filter((text) => text.startsWith("mouse"))).toEqual([
            "mouse 0.5 0.5 left ×2 in 0ms",
            "mouse 0.25 0.75 in 0ms",
            "mouse 0 1 right in 0ms",
          ]);
          expect(yield* collect(events, 3)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "send-mouse", state: "running" },
            { type: "action", id: 1, state: "completed" },
          ]);
          // A double click is four input-send-event exchanges, a move one, a click two.
          expect(
            h.actions.actions.filter(
              (row) =>
                Schema.is(Domain.QmpCommand)(row.request) &&
                row.request.execute === "input-send-event",
            ),
          ).toHaveLength(7);
        }),
      );
    }),
  );

  it.effect("a failing exchange fails ExchangeFailed", () =>
    Effect.gen(function* () {
      const h = harness({
        script: {
          sendMouse: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const error = yield* Effect.flip(sessions.sendMouse(live, mouse(id, 0.5, 0.5)));
          expect(error).toMatchObject({ _tag: "ExchangeFailed", message: "qemu: socket closed" });
          expect(line(h, "mouse")).toBeUndefined();
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// intents
// ---------------------------------------------------------------------------

describe("intents", () => {
  it.effect("intentStart opens the span, tells followers and refuses a second one", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          yield* sessions.intentStart(live, "result-1", "open a terminal");
          expect(yield* Effect.flip(sessions.intentStart(live, "result-1", "again"))).toMatchObject(
            {
              _tag: "BadRequest",
              message:
                "Cannot start one intent when one's already running. Please end your previous intent.",
              sessionId: id,
              agentId: AGENT,
            },
          );
          expect(yield* collect(events, 2)).toEqual([
            { type: "session", status: "running" },
            { type: "intent", state: "started", message: "open a terminal" },
          ]);
          const intent = spanNamed(h, "open a terminal");
          expect(intent?.attributes.get("sentry.op")).toBe("agent.intent");
          expect(intent?.attributes.get("test_result_id")).toBe("result-1");
          expect(intent?.attributes.get("intent")).toBe("open a terminal");
          expect(endedWith(intent)).toBeUndefined();
          expect(Option.map(yield* Ref.get(live.intent), (open) => open.message)).toEqual(
            Option.some("open a terminal"),
          );
          expect(line(h, "intent start")).toMatchObject({
            text: "intent start; open a terminal",
            sessionId: id,
            agentId: AGENT,
          });
          // Actions started under an intent hang off its span.
          yield* sessions.sendKeys(live, "a", undefined);
          const action = spanNamed(h, "QMP send-key");
          expect(Option.getOrUndefined(action?.parent ?? Option.none())?.spanId).toBe(
            intent?.spanId,
          );
        }),
      );
    }),
  );

  it.effect("intentEnd completes the span and refuses when none is open", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          expect(yield* Effect.flip(sessions.intentEnd(live))).toMatchObject({
            _tag: "BadRequest",
            message: "no active intent",
            sessionId: id,
            agentId: AGENT,
          });
          const events = yield* sessions.follow(id);
          yield* sessions.intentStart(live, "result-1", "type hello");
          yield* sessions.intentEnd(live);
          expect(yield* collect(events, 3)).toEqual([
            { type: "session", status: "running" },
            { type: "intent", state: "started", message: "type hello" },
            { type: "intent", state: "completed" },
          ]);
          const intent = spanNamed(h, "type hello");
          expect(intent?.attributes.get("intent_state")).toBe("completed");
          expect(endedWith(intent)).toBe("ok");
          expect(yield* Ref.get(live.intent)).toEqual(Option.none());
          expect(line(h, "intent end")).toMatchObject({
            text: "intent end",
            sessionId: id,
            agentId: AGENT,
          });
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe("stop", () => {
  // One Log fake whose lines and colour releases share a single ordered record.
  const orderedLog = () => {
    const order: Array<string> = [];
    const record = (text: string) =>
      Effect.sync(() => {
        order.push(text);
      });
    const service: Log.LogService = {
      info: record,
      warning: record,
      error: record,
      fatal: record,
      acquireColor: (agentId) => record(`acquireColor ${agentId}`),
      releaseColor: (agentId) => record(`releaseColor ${agentId}`),
      flush: Effect.void,
    };
    return { order, layer: Layer.succeed(Log.Log)(service) };
  };

  it.effect("forgets the session, kills it, closes the row and tells followers last", () =>
    Effect.gen(function* () {
      const ordered = orderedLog();
      const h = harness({ log: ordered.layer });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          yield* sessions.intentStart(live, "result-1", "shut the lid");
          yield* sessions.stop(live, undefined, undefined);
          expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
            _tag: "UnknownSession",
          });
          expect(yield* qemus(sessions)).toBe(0);
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start", "stop"]);
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "aborted", reason: null });
          expect(h.sessions.sessions[0]?.endedAt).not.toBeNull();
          expect(h.sessions.agentRuns[0]?.endedAt).not.toBeNull();
          expect(ordered.order.slice(-2)).toEqual(["stopped; aborted", `releaseColor ${AGENT}`]);
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "intent", state: "started", message: "shut the lid" },
            { type: "intent", state: "cancelled" },
            { type: "session", status: "aborted" },
          ]);
          expect(endedWith(spanNamed(h, "shut the lid"))).toBe("aborted");
          expect(spanNamed(h, "shut the lid")?.attributes.get("intent_state")).toBe("cancelled");
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("aborted");
          expect(spanNamed(h, "QEMU session")?.attributes.get("session_status")).toBe("aborted");
          expect(yield* Ref.get(live.followers)).toEqual(new Set());
          expect(yield* Effect.flip(sessions.follow(id))).toMatchObject({
            _tag: "Conflict",
            message: `session "${id}" has already completed (aborted)`,
          });
        }),
      );
    }),
  );

  it.effect("keeps the caller's status and reason", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* sessions.stop(live, "succeeded", "installed");
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "succeeded",
            reason: "installed",
          });
          expect(line(h, "stopped")).toMatchObject({
            text: "stopped; succeeded; installed",
            sessionId: id,
            agentId: AGENT,
          });
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("ok");
        }),
      );
    }),
  );

  it.effect("a failing kill is logged and the record still closes", () =>
    Effect.gen(function* () {
      const h = harness({ script: { stop: () => Effect.die(new Error("EACCES: rm failed")) } });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* sessions.stop(live, undefined, "done");
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "aborted", reason: "done" });
          const logged = line(h, "stop cleanup failed:");
          expect(logged).toMatchObject({
            level: "error",
            text: "stop cleanup failed: EACCES: rm failed",
            sessionId: id,
            agentId: AGENT,
            skipSentry: false,
          });
          expect(logged?.cause).toBeInstanceOf(Error);
          expect(texts(h).at(-1)).toBe("stopped; aborted; done");
        }),
      );
    }),
  );

  it.effect("a stop racing the sweep is unknown session: the session gets one verdict", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const ended: Array<string> = [];
      const h = harness({
        sessionStore: {
          endSession: (id, status) =>
            Effect.gen(function* () {
              ended.push(`${status} ${id}`);
              if (status === "timed_out") {
                yield* Deferred.await(gate);
              }
            }),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          yield* TestClock.adjust("10 minutes");
          // The sweep has taken the session and is closing its record.
          expect(ended).toEqual([`timed_out ${id}`]);
          const error = yield* Effect.flip(sessions.stop(live, "succeeded", "done"));
          expect(error).toMatchObject({
            _tag: "UnknownSession",
            id,
            message: `unknown session "${id}"`,
            agentId: AGENT,
          });
          yield* Deferred.succeed(gate, undefined);
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "timed_out" },
          ]);
          expect(ended).toEqual([`timed_out ${id}`]);
          expect(h.qemu.calls.filter((call) => call._tag === "stop")).toHaveLength(1);
          expect(
            texts(h).filter((text) => text.startsWith("stopped") || text.startsWith("timed out")),
          ).toEqual(["timed out; no command received for 10 minutes"]);
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("deadline_exceeded");
        }),
      );
    }),
  );

  it.effect("a record that cannot be closed fails Internal after the session is finished", () =>
    Effect.gen(function* () {
      const h = harness({
        sessionStore: {
          endSession: () => Effect.fail(failure("endSession", "connect ECONNREFUSED")),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          const error = yield* Effect.flip(sessions.stop(live, undefined, undefined));
          expect(error).toMatchObject({ _tag: "Internal", sessionId: id, agentId: AGENT });
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start", "stop"]);
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "aborted" },
          ]);
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("aborted");
          expect(line(h, "stopped")).toBeUndefined();
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// follow
// ---------------------------------------------------------------------------

describe("follow", () => {
  it.effect(
    "opens with pending while booting, then running, the open intent and the last image",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const h = harness({ script: { boot: () => Deferred.await(gate) } });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const booting = yield* Effect.forkChild(sessions.start(startBody(), "none", false), {
              startImmediately: true,
            });
            const id = h.sessions.sessions[0]?.id ?? "";
            expect(Domain.isSessionId(id)).toBe(true);
            const early = yield* sessions.follow(id);
            expect(yield* collect(early, 1)).toEqual([{ type: "session", status: "pending" }]);
            expect(line(h, "follower attached")).toMatchObject({ sessionId: id, agentId: AGENT });
            yield* Deferred.succeed(gate, undefined);
            expect(yield* Fiber.join(booting)).toBe(id);
            const live = yield* sessions.lookup(id, AGENT);
            yield* sessions.intentStart(live, "result-1", "log in");
            const { imageId } = yield* sessions.image(live);
            const later = yield* sessions.follow(id);
            expect(yield* collect(later, 3)).toEqual([
              { type: "session", status: "running" },
              { type: "intent", state: "started", message: "log in" },
              { type: "image", id: imageId, png: Buffer.from(FakeQemu.PNG).toString("base64") },
            ]);
          }),
        );
      }),
  );

  it.effect("refuses unknown ids and sessions this proxy does not hold", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          expect(yield* Effect.flip(sessions.follow(UNKNOWN_ID))).toMatchObject({
            _tag: "UnknownSession",
            id: UNKNOWN_ID,
          });
          expect(yield* Effect.flip(sessions.follow("not-a-uuid"))).toMatchObject({
            _tag: "UnknownSession",
            id: "not-a-uuid",
          });
          h.sessions.sessions.push(
            {
              id: UNKNOWN_ID,
              config: { iso: ISO },
              status: "running",
              reason: null,
              startedAt: new Date(0),
              endedAt: null,
            },
            {
              id: "2baaad43-674b-4bdb-88d7-3f18fce50aba",
              config: { iso: ISO },
              status: "downloading",
              reason: null,
              startedAt: new Date(0),
              endedAt: null,
            },
            {
              id: "3baaad43-674b-4bdb-88d7-3f18fce50aba",
              config: { iso: ISO },
              status: "timed_out",
              reason: "no command received for 10 minutes",
              startedAt: new Date(0),
              endedAt: new Date(0),
            },
          );
          expect(yield* Effect.flip(sessions.follow(UNKNOWN_ID))).toMatchObject({
            _tag: "Conflict",
            message: `session "${UNKNOWN_ID}" is not running on this proxy`,
            sessionId: UNKNOWN_ID,
          });
          expect(
            yield* Effect.flip(sessions.follow("2baaad43-674b-4bdb-88d7-3f18fce50aba")),
          ).toMatchObject({
            _tag: "Conflict",
            message: `session "2baaad43-674b-4bdb-88d7-3f18fce50aba" is not running on this proxy`,
          });
          expect(
            yield* Effect.flip(sessions.follow("3baaad43-674b-4bdb-88d7-3f18fce50aba")),
          ).toMatchObject({
            _tag: "Conflict",
            message: `session "3baaad43-674b-4bdb-88d7-3f18fce50aba" has already completed (timed_out)`,
          });
          expect(texts(h)).toEqual([]);
        }),
      );
    }),
  );

  it.effect("a status lookup that fails is Internal", () =>
    Effect.gen(function* () {
      const h = harness({
        sessionStore: {
          getSessionStatus: () => Effect.fail(failure("getSessionStatus", "connect ECONNREFUSED")),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          expect(yield* Effect.flip(sessions.follow(UNKNOWN_ID))).toMatchObject({
            _tag: "Internal",
            sessionId: UNKNOWN_ID,
          });
        }),
      );
    }),
  );

  it.effect("logs a detach when the consumer leaves and not when the session ends", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const leaving = yield* sessions.follow(id);
          expect(yield* collect(leaving, 1)).toEqual([{ type: "session", status: "running" }]);
          expect(texts(h).filter((text) => text.startsWith("follower"))).toEqual([
            "follower attached",
            "follower detached",
          ]);
          expect(yield* Ref.get(live.followers)).toEqual(new Set());
          const staying = yield* sessions.follow(id);
          const reader = yield* Effect.forkChild(Stream.runCollect(staying), {
            startImmediately: true,
          });
          yield* sessions.stop(live, undefined, undefined);
          expect(yield* Fiber.join(reader)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "aborted" },
          ]);
          expect(texts(h).filter((text) => text.startsWith("follower"))).toEqual([
            "follower attached",
            "follower detached",
            "follower attached",
          ]);
        }),
      );
    }),
  );

  it.effect("drops a follower 64 events behind and never sends it the final session line", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          // The queue holds the session line plus 63 action events; the 65th offer drops it.
          for (let n = 0; n < 32; n++) {
            yield* sessions.sendKeys(live, "a", undefined);
          }
          expect(line(h, "follower dropped")).toMatchObject({
            level: "warning",
            text: "follower dropped; 64 events behind",
            sessionId: id,
            agentId: AGENT,
          });
          expect(
            texts(h).filter((text) => text === "follower dropped; 64 events behind"),
          ).toHaveLength(1);
          expect(yield* Ref.get(live.followers)).toEqual(new Set());
          yield* sessions.stop(live, undefined, undefined);
          const received = yield* Stream.runCollect(events);
          expect(received).toHaveLength(64);
          expect(received[0]).toEqual({ type: "session", status: "running" });
          expect(received.at(-1)).toEqual({
            type: "action",
            id: 32,
            name: "send-keys",
            state: "running",
          });
          expect(
            received.some((event) => event.type === "session" && event.status === "aborted"),
          ).toBe(false);
          expect(texts(h).filter((text) => text === "follower detached")).toEqual([]);
        }),
      );
    }),
  );

  it.effect("a session that ends right after a follow still ends the fresh queue", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          yield* sessions.stop(live, "failed", "gave up");
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "failed" },
          ]);
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// dump
// ---------------------------------------------------------------------------

describe("dump", () => {
  it.effect("refuses a non-uuid before touching the disk", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          expect(yield* Effect.flip(sessions.dump("nope"))).toMatchObject({
            _tag: "UnknownSession",
            id: "nope",
            message: 'unknown session "nope"',
          });
          expect(h.fsCalls).toEqual([]);
        }),
      );
    }),
  );

  it.effect("reads the running machine's console without resetting its activity", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          h.files.set(serialPath(h, id), Effect.succeed(SERIAL));
          yield* TestClock.adjust("1 minute");
          expect(yield* sessions.dump(id)).toBe(SERIAL);
          expect(yield* Ref.get(live.lastCommandAt)).toBe(0);
          expect(line(h, "dump;")).toMatchObject({
            text: `dump; ${String(SERIAL.length)} bytes from the running machine in 0ms`,
            sessionId: id,
            agentId: AGENT,
          });
          expect(h.actions.actions).toHaveLength(1);
        }),
      );
    }),
  );

  it.effect(
    "reads a dead session's surviving directory from disk and refuses when it is gone",
    () =>
      Effect.gen(function* () {
        const h = harness();
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const dead = `${h.qemu.sessionDir(UNKNOWN_ID)}/serial.log`;
            expect(yield* Effect.flip(sessions.dump(UNKNOWN_ID))).toMatchObject({
              _tag: "Conflict",
              message: `session "${UNKNOWN_ID}" has no console on this proxy`,
              sessionId: UNKNOWN_ID,
            });
            expect(h.fsCalls).toEqual([`readFile ${dead}`]);
            h.files.set(dead, Effect.succeed(SERIAL));
            expect(yield* sessions.dump(UNKNOWN_ID)).toBe(SERIAL);
            expect(line(h, "dump;")).toMatchObject({
              text: `dump; ${String(SERIAL.length)} bytes from disk in 0ms`,
              sessionId: UNKNOWN_ID,
              agentId: undefined,
            });
            h.files.set(dead, Effect.fail(denied("readFile", dead)));
            expect(yield* Effect.flip(sessions.dump(UNKNOWN_ID))).toMatchObject({
              _tag: "Internal",
              sessionId: UNKNOWN_ID,
            });
          }),
        );
      }),
  );
});

// ---------------------------------------------------------------------------
// timeouts
// ---------------------------------------------------------------------------

describe("timeouts", () => {
  it.effect("ten idle minutes time the session out, close its record and its followers", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id } = yield* start();
          const events = yield* sessions.follow(id);
          yield* TestClock.adjust("590 seconds");
          expect(yield* qemus(sessions)).toBe(1);
          yield* TestClock.adjust("10 seconds");
          expect(yield* qemus(sessions)).toBe(0);
          expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
            _tag: "UnknownSession",
          });
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start", "stop"]);
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "timed_out",
            reason: "no command received for 10 minutes",
          });
          expect(line(h, "timed out")).toMatchObject({
            level: "info",
            text: "timed out; no command received for 10 minutes",
            sessionId: id,
            agentId: undefined,
          });
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("deadline_exceeded");
          expect(spanNamed(h, "QEMU session")?.attributes.get("session_status")).toBe("timed_out");
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "timed_out" },
          ]);
          expect(h.log.released).toEqual([AGENT]);
        }),
      );
    }),
  );

  it.effect("a command within ten minutes keeps the session alive", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id } = yield* start();
          yield* TestClock.adjust("9 minutes");
          yield* sessions.lookup(id, AGENT);
          yield* TestClock.adjust("9 minutes");
          expect(yield* qemus(sessions)).toBe(1);
          expect(h.sessions.sessions[0]?.status).toBe("running");
          yield* TestClock.adjust("1 minute");
          expect(yield* qemus(sessions)).toBe(0);
          expect(h.sessions.sessions[0]?.status).toBe("timed_out");
        }),
      );
    }),
  );

  it.effect("a failing kill during the sweep is logged and the record still closes", () =>
    Effect.gen(function* () {
      const h = harness({ script: { stop: () => Effect.die(new Error("rm failed")) } });
      yield* h.run(
        Effect.gen(function* () {
          const { id } = yield* start();
          yield* TestClock.adjust("10 minutes");
          expect(line(h, "timeout cleanup failed")).toMatchObject({
            level: "error",
            text: "timeout cleanup failed: rm failed",
            sessionId: id,
            agentId: undefined,
          });
          expect(h.sessions.sessions[0]?.status).toBe("timed_out");
          expect(texts(h).at(-1)).toBe("timed out; no command received for 10 minutes");
        }),
      );
    }),
  );

  it.effect("a record that cannot be closed logs the failure and still finishes the session", () =>
    Effect.gen(function* () {
      const h = harness({
        sessionStore: {
          endSession: (_id, status) =>
            status === "timed_out"
              ? Effect.fail(failure("endSession", "connect ECONNREFUSED 127.0.0.1:5432"))
              : Effect.void,
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id } = yield* start();
          const events = yield* sessions.follow(id);
          yield* TestClock.adjust("10 minutes");
          const logged = line(h, "recording timeout failed");
          expect(logged).toMatchObject({
            level: "error",
            text: "recording timeout failed: connect ECONNREFUSED 127.0.0.1:5432",
            sessionId: id,
          });
          expect(logged?.cause).toMatchObject({ _tag: "DatabaseError" });
          expect(line(h, "timed out")).toBeUndefined();
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "timed_out" },
          ]);
          expect(endedWith(spanNamed(h, "QEMU session"))).toBe("deadline_exceeded");
          expect(yield* qemus(sessions)).toBe(0);
        }),
      );
    }),
  );

  it.effect("one sweep at a time: a stuck sweep is not overlapped by the next tick", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const ended: Array<string> = [];
      const h = harness({
        sessionStore: {
          endSession: (id, status) =>
            Effect.gen(function* () {
              ended.push(`${status} ${id}`);
              if (status === "timed_out" && ended.length === 1) {
                yield* Deferred.await(gate);
              }
            }),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const first = yield* start(AGENT);
          yield* TestClock.adjust("5 seconds");
          const second = yield* start(OTHER_AGENT);
          yield* TestClock.adjust("595 seconds");
          expect(ended).toEqual([`timed_out ${first.id}`]);
          yield* TestClock.adjust("2 minutes");
          expect(ended).toEqual([`timed_out ${first.id}`]);
          expect(yield* qemus(first.sessions)).toBe(1);
          yield* Deferred.succeed(gate, undefined);
          yield* TestClock.adjust("10 seconds");
          expect(ended).toEqual([`timed_out ${first.id}`, `timed_out ${second.id}`]);
          expect(yield* qemus(first.sessions)).toBe(0);
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

describe("drain", () => {
  it.effect("stops every session as aborted with the shutdown reason", () =>
    Effect.gen(function* () {
      const shutdown: Sessions.Shutdown = {
        reason: MutableRef.make("proxy shutdown"),
        failed: MutableRef.make(false),
      };
      const h = harness({ shutdown });
      const drained = yield* h.run(
        Effect.gen(function* () {
          const first = yield* start(AGENT);
          const second = yield* start(OTHER_AGENT);
          const events = yield* first.sessions.follow(first.id);
          const reader = yield* Effect.forkChild(Stream.runCollect(events), {
            startImmediately: true,
          });
          return { reader, ids: [first.id, second.id] };
        }),
      );
      expect(h.qemu.calls.map((call) => call._tag)).toEqual([
        "prepare",
        "start",
        "prepare",
        "start",
        "stop",
        "stop",
      ]);
      expect(h.sessions.sessions.map((row) => [row.status, row.reason])).toEqual([
        ["aborted", "proxy shutdown"],
        ["aborted", "proxy shutdown"],
      ]);
      const drainLines = h.log.lines.filter(
        (entry) => entry.text.startsWith("proxy:") || entry.text.startsWith("stopped"),
      );
      expect(drainLines[0]).toMatchObject({
        level: "info",
        text: "proxy: shutting down; stopping 2 sessions",
        sessionId: undefined,
        agentId: undefined,
      });
      expect(drainLines.slice(1).map((entry) => entry.text)).toEqual([
        "stopped; aborted; proxy shutdown",
        "stopped; aborted; proxy shutdown",
      ]);
      expect(new Set(drainLines.slice(1).map((entry) => entry.sessionId))).toEqual(
        new Set(drained.ids),
      );
      expect(drainLines.slice(1).every((entry) => entry.agentId === undefined)).toBe(true);
      expect(yield* Fiber.join(drained.reader)).toEqual([
        { type: "session", status: "running" },
        { type: "session", status: "aborted" },
      ]);
      expect(h.tracer.spans.filter((span) => span.name === "QEMU session").map(endedWith)).toEqual([
        "aborted",
        "aborted",
      ]);
      expect(h.log.released.sort()).toEqual([AGENT, OTHER_AGENT]);
      expect(MutableRef.get(shutdown.failed)).toBe(false);
    }),
  );

  it.effect("reads the reason the server error path sets", () =>
    Effect.gen(function* () {
      const shutdown: Sessions.Shutdown = {
        reason: MutableRef.make("proxy shutdown"),
        failed: MutableRef.make(false),
      };
      const h = harness({ shutdown });
      yield* h.run(
        Effect.gen(function* () {
          yield* start();
          MutableRef.set(shutdown.reason, "proxy error: listen EADDRINUSE");
        }),
      );
      expect(h.sessions.sessions[0]).toMatchObject({
        status: "aborted",
        reason: "proxy error: listen EADDRINUSE",
      });
      expect(texts(h).slice(-2)).toEqual([
        "proxy: shutting down; stopping 1 sessions",
        "stopped; aborted; proxy error: listen EADDRINUSE",
      ]);
    }),
  );

  it.effect("sessions that cannot be closed mark the shutdown failed", () =>
    Effect.gen(function* () {
      const shutdown: Sessions.Shutdown = {
        reason: MutableRef.make("proxy shutdown"),
        failed: MutableRef.make(false),
      };
      const unkillable: Array<string> = [];
      const ended: Array<string> = [];
      const h = harness({
        shutdown,
        script: {
          stop: (id) =>
            unkillable.includes(id) ? Effect.die(new Error("rm failed")) : Effect.void,
        },
        sessionStore: {
          endSession: (id) =>
            Effect.suspend(() => {
              ended.push(id);
              return id === h.sessions.sessions[0]?.id
                ? Effect.fail(failure("endSession", "connect ECONNREFUSED"))
                : Effect.void;
            }),
        },
      });
      const ids = yield* h.run(
        Effect.gen(function* () {
          const first = yield* start(AGENT);
          const second = yield* start(OTHER_AGENT);
          const third = yield* start("OLI-63");
          unkillable.push(second.id);
          return [first.id, second.id, third.id];
        }),
      );
      expect(MutableRef.get(shutdown.failed)).toBe(true);
      const logged = h.log.lines.filter((entry) => entry.text.startsWith("shutdown:"));
      expect(logged).toMatchObject([
        { level: "error", text: "shutdown: Failed query: endSession", sessionId: ids[0] },
        { level: "error", text: "shutdown: rm failed", sessionId: ids[1] },
      ]);
      expect(logged[0]?.cause).toMatchObject({ _tag: "DatabaseError" });
      expect(logged[1]?.cause).toBeInstanceOf(Error);
      expect(texts(h).filter((text) => text.startsWith("stopped"))).toEqual([
        "stopped; aborted; proxy shutdown",
      ]);
      expect(h.qemu.calls.filter((call) => call._tag === "stop")).toHaveLength(3);
      // The machine that would not die never reaches the row close.
      expect(ended.sort()).toEqual([ids[0], ids[2]].sort());
      // A killed machine whose row would not close still ended aborted; one that would not die
      // ended failed.
      const spans = h.tracer.spans.filter((span) => span.name === "QEMU session");
      expect(spans.map((span) => [span.attributes.get("session_id"), endedWith(span)])).toEqual([
        [ids[0], "aborted"],
        [ids[1], "internal_error"],
        [ids[2], "aborted"],
      ]);
      expect(h.log.released.sort()).toEqual([AGENT, OTHER_AGENT, "OLI-63"]);
    }),
  );

  it.effect("with nothing running it only announces itself", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(Effect.asVoid(Sessions.Sessions));
      expect(texts(h)).toEqual(["proxy: shutting down; stopping 0 sessions"]);
      expect(h.qemu.calls).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe("stats", () => {
  it.effect("reports the number of running machines", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          expect((yield* sessions.stats).qemus).toBe(0);
          expect(yield* qemus(sessions)).toBe(0);
          const { live } = yield* start();
          yield* start(OTHER_AGENT);
          expect(yield* sessions.stats).toEqual(
            Contract.Stats.make({ qemus: 2, ...FakeQemu.ZERO_STATS }),
          );
          expect(yield* qemus(sessions)).toBe(2);
          yield* sessions.stop(live, undefined, undefined);
          expect((yield* sessions.stats).qemus).toBe(1);
        }),
      );
    }),
  );
});
