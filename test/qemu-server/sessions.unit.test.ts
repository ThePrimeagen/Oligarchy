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
import * as Contract from "@oligarchy/routes/contract";
import * as ApiErrors from "@oligarchy/routes/errors";
import * as Sessions from "../../src/qemu-server/sessions.ts";
import type * as Qemu from "../../src/qemu/qemu.ts";
import * as Log from "../../src/observability/log.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeMinted from "../support/fake-minted.ts";
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
// Postgres refusing a new connection at its ceiling, as PlanetScale answered it in OLI-1309.
const SLOTS_REFUSED =
  "remaining connection slots are reserved for roles with the SUPERUSER attribute";
// Room for every session a test below starts; the capacity tests pass their own.
const MAX_JOBS = 4;

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
  readonly minted?: FakeMinted.Script;
  readonly sessionStore?: Parameters<typeof Stores.fakeSessionStore>[0];
  readonly actionStore?: Parameters<typeof Stores.fakeActionStore>[0];
  readonly debugLogStore?: Parameters<typeof Stores.fakeDebugLogStore>[0];
  readonly log?: Layer.Layer<Log.Log>;
  readonly shutdown?: Sessions.Shutdown;
  readonly maxJobs?: number;
  readonly selfUrl?: string;
};

const harness = (options: Options = {}) => {
  const sessions = Stores.fakeSessionStore(options.sessionStore);
  const actions = Stores.fakeActionStore(options.actionStore);
  const debugLogs = Stores.fakeDebugLogStore(options.debugLogStore);
  const log = FakeLog.fakeLog();
  const tracer = Recording.recording();
  const qemu = FakeQemu.fakeQemu(options.script);
  const iso = FakeQemu.fakeIso(options.resolveIso);
  const minted = FakeMinted.fakeMinted(options.minted);
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
  const layer = Sessions.Sessions.layer(options.maxJobs ?? MAX_JOBS, options.selfUrl).pipe(
    Layer.provide(
      Layer.mergeAll(
        qemu.layer,
        iso.layer,
        minted.layer,
        FakeQemu.fakeStats,
        sessions.layer,
        actions.layer,
        debugLogs.layer,
        options.log ?? log.layer,
        fs,
        Path.layer,
        shutdown,
      ),
    ),
  );
  // The recording tracer is provided beneath the service and to the caller: spans are made in
  // whichever fiber calls a method.
  const run = <A, E>(
    body: Effect.Effect<A, E, Sessions.Sessions>,
  ): Effect.Effect<A, E | Errors.DatabaseError> =>
    body.pipe(Effect.provide(layer.pipe(Layer.provideMerge(tracer.layer))));
  return { sessions, actions, debugLogs, log, tracer, qemu, iso, minted, files, fsCalls, run };
};

type Harness = ReturnType<typeof harness>;

const startBody = (iso = ISO, agent = AGENT, disk?: string) =>
  disk === undefined
    ? Contract.StartBody.make({ iso, agent })
    : Contract.StartBody.make({ iso, agent, disk });

const reservedStart = (
  body: Contract.StartBody,
  display: Domain.QemuDisplay = "none",
  automation = false,
) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    yield* sessions.reserve(body.agent);
    return yield* sessions.start(body, display, automation);
  });

const start = (agent = AGENT, iso = ISO) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    const id = yield* reservedStart(startBody(iso, agent));
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

// How many machines the qemu server holds, as /stats reports it.
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
                order.push(`start ${String(input.cdrom)}`);
              }),
          },
        });
        h.files.set(DISK, Effect.succeed(new Uint8Array()));
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const id = yield* reservedStart(startBody(URL_ISO, AGENT, DISK), "gtk", true);
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
              { _tag: "prepare", id, source: { _tag: "existing", path: DISK } },
              {
                _tag: "start",
                id,
                cdrom: "/cache/omarchy.iso",
                diskPath: DISK,
                display: "gtk",
                automation: true,
              },
            ]);
            expect(texts(h)).toEqual([
              `starting; iso ${URL_ISO}, disk ${DISK}`,
              "running; started in 0ms",
            ]);
            expect(h.log.lines[0]).toMatchObject({ level: "info", location: id, agentId: AGENT });
            const span = spanNamed(h, AGENT);
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
          const error = yield* Effect.flip(reservedStart(startBody(URL_ISO, AGENT, DISK)));
          expect(error).toMatchObject({
            _tag: "StartFailed",
            message: `qemu: disk not found: ${DISK}`,
            agentId: AGENT,
          });
          expect(h.iso.calls).toEqual([]);
          expect(h.sessions.agentRuns).toEqual([]);
          expect(h.qemu.calls).toEqual([]);
          expect(h.sessions.sessions).toMatchObject([
            { status: "errored", reason: `qemu: disk not found: ${DISK}` },
          ]);
        }),
      );
    }),
  );

  it.effect("a failing qemu-img leaves the agent unregistered and the row errored", () =>
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
          const error = yield* Effect.flip(reservedStart(startBody(URL_ISO)));
          expect(error).toMatchObject({
            _tag: "StartFailed",
            message: "qemu-img create exited 1",
            agentId: AGENT,
          });
          expect(h.iso.calls).toHaveLength(1);
          expect(h.sessions.agentRuns).toEqual([]);
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare"]);
          expect(h.sessions.sessions).toMatchObject([
            { status: "errored", reason: "qemu-img create exited 1" },
          ]);
          // The registration was never spent and the failed start kept the reservation: the
          // same agent boots on its next try without reserving again.
          const id = yield* sessions.start(startBody(), "none", false);
          expect(h.sessions.agentRuns).toMatchObject([{ agentId: AGENT, sessionId: id }]);
          expect(yield* qemus(sessions)).toBe(1);
        }),
      );
    }),
  );

  it.effect(
    "a boot failure stops the machine, ends the row errored with the detail and fails StartFailed",
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
            const error = yield* Effect.flip(reservedStart(startBody()));
            expect(error._tag).toBe("StartFailed");
            if (error._tag !== "StartFailed") {
              return;
            }
            const id = error.sessionId;
            expect(error.message).toBe("qemu: handshake timeout: kvm: disabled");
            expect(error.agentId).toBe(AGENT);
            expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start", "stop"]);
            expect(h.sessions.sessions).toMatchObject([
              { id, status: "errored", reason: "qemu: handshake timeout: kvm: disabled" },
            ]);
            expect(endedWith(spanNamed(h, AGENT))).toBe("internal_error");
            expect(spanNamed(h, AGENT)?.attributes.get("session_status")).toBe("errored");
            expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
              _tag: "UnknownSession",
              id,
            });
            expect(yield* Effect.flip(sessions.follow(id))).toMatchObject({
              _tag: "Conflict",
              message: `session "${id}" has already completed (errored)`,
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
            const error = yield* Effect.flip(reservedStart(startBody()));
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
          const error = yield* Effect.flip(reservedStart(startBody()));
          expect(error).toMatchObject({
            _tag: "Internal",
            message: "internal error",
            agentId: AGENT,
          });
          expect(h.iso.calls).toEqual([]);
          expect(endedWith(spanNamed(h, AGENT))).toBe("internal_error");
          expect(texts(h)).toEqual([]);
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// start --resume
// ---------------------------------------------------------------------------

describe("start resume", () => {
  const MINTED = { disk: `${URL_ISO}.qcow2`, vars: `${URL_ISO}.OVMF_VARS.fd` };
  const resume = (iso = URL_ISO, agent = AGENT) =>
    Contract.StartBody.make({ iso, agent, mode: "resume" });

  it.effect(
    "boots an overlay of the minted disk with its firmware, no download, no cdrom, and records the mode",
    () =>
      Effect.gen(function* () {
        const h = harness({ minted: { find: () => Option.some(MINTED) } });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.reserve(AGENT);
            const id = yield* sessions.start(resume(), "none", true);
            expect(h.minted.finds).toEqual([URL_ISO]);
            expect(h.iso.calls).toEqual([]);
            expect(h.qemu.calls).toEqual([
              { _tag: "prepare", id, source: { _tag: "minted", ...MINTED } },
              {
                _tag: "start",
                id,
                cdrom: undefined,
                diskPath: `${h.qemu.sessionDir(id)}/disk.qcow2`,
                display: "none",
                automation: true,
              },
            ]);
            // Nothing to download: the row is running from the start.
            expect(h.sessions.sessions).toMatchObject([
              { id, status: "running", config: { iso: URL_ISO, mode: "resume" } },
            ]);
            expect(h.sessions.agentRuns).toMatchObject([{ agentId: AGENT, sessionId: id }]);
            expect(line(h, "starting")).toMatchObject({
              text: `starting; iso ${URL_ISO}; resume`,
              location: id,
              agentId: AGENT,
            });
            expect(yield* qemus(sessions)).toBe(1);
          }),
        );
      }),
  );

  it.effect("a fresh start records no mode and boots as before", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const id = yield* reservedStart(startBody());
          expect(h.minted.finds).toEqual([]);
          expect(h.sessions.sessions[0]?.config).toEqual({ iso: ISO });
          expect(h.qemu.calls[0]).toEqual({ _tag: "prepare", id, source: { _tag: "fresh" } });
        }),
      );
    }),
  );

  it.effect(
    "without a minted disk on this machine it is an internal error before anything is minted, and the reservation stands",
    () =>
      Effect.gen(function* () {
        const h = harness();
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.reserve(AGENT);
            const error = yield* Effect.flip(sessions.start(resume(), "none", false));
            expect(error).toMatchObject({
              _tag: "Internal",
              message: "internal error",
              agentId: AGENT,
              cause: expect.objectContaining({
                message: `no minted disk for ${URL_ISO} on this machine`,
              }),
            });
            expect(error._tag === "Internal" ? error.sessionId : "set").toBeUndefined();
            expect(h.sessions.sessions).toEqual([]);
            expect(h.qemu.calls).toEqual([]);
            expect(h.iso.calls).toEqual([]);
            expect(texts(h)).toEqual([]);
            // The reservation is still the agent's: a fresh start consumes it, and relinquish
            // would have given it back.
            expect(yield* sessions.jobs).toBe(1);
            const id = yield* sessions.start(startBody(URL_ISO), "none", false);
            expect(Domain.isSessionId(id)).toBe(true);
            expect(yield* sessions.jobs).toBe(1);
          }),
        );
      }),
  );

  it.effect("a resume with a caller-provided disk is refused: the minted disk is the disk", () =>
    Effect.gen(function* () {
      const h = harness({ minted: { find: () => Option.some(MINTED) } });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const error = yield* Effect.flip(
            sessions.start(
              Contract.StartBody.make({ iso: URL_ISO, agent: AGENT, disk: DISK, mode: "resume" }),
              "none",
              false,
            ),
          );
          expect(error).toMatchObject({
            _tag: "BadRequest",
            message: "a resume boots the minted disk; --disk cannot be given",
            agentId: AGENT,
          });
          expect(h.minted.finds).toEqual([]);
          expect(h.sessions.sessions).toEqual([]);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );

  it.effect("a reserve pinned to this server takes the slot", () =>
    Effect.gen(function* () {
      const self = "http://127.0.0.1:55332";
      const h = harness({ selfUrl: self });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT, undefined, self);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );

  it.effect("a reserve pinned to another server takes no slot (unhappy)", () =>
    Effect.gen(function* () {
      const self = "http://127.0.0.1:55332";
      const h = harness({ selfUrl: self });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(
            sessions.reserve(AGENT, undefined, "http://127.0.0.1:55333"),
          );
          expect(error).toMatchObject({
            _tag: "BadRequest",
            message: "reserve is for http://127.0.0.1:55333, not http://127.0.0.1:55332",
            agentId: AGENT,
          });
          expect(yield* sessions.jobs).toBe(0);
          yield* sessions.reserve(OTHER_AGENT);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );

  it.effect(
    "a resume of an iso this machine holds is a reservation, and a fresh one never asks",
    () =>
      Effect.gen(function* () {
        const h = harness({ minted: { find: () => Option.some(MINTED) } });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.reserve(AGENT, URL_ISO);
            expect(yield* sessions.jobs).toBe(1);
            expect(h.minted.finds).toEqual([URL_ISO]);
            yield* sessions.reserve(OTHER_AGENT);
            expect(yield* sessions.jobs).toBe(2);
            expect(h.minted.finds).toEqual([URL_ISO]);
          }),
        );
      }),
  );

  it.effect("a resume of an iso this machine does not hold is 409 and takes no slot", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(sessions.reserve(AGENT, URL_ISO));
          expect(error).toMatchObject({
            _tag: "SetupNeeded",
            message: "setup needed: max-jobs is 4",
            agentId: AGENT,
          });
          expect(h.minted.finds).toEqual([URL_ISO]);
          expect(yield* sessions.jobs).toBe(0);
          // The slot was never taken: a fresh reserve can still have it.
          yield* sessions.reserve(AGENT);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );

  it.effect("a resume of an unminted iso on a full machine is at capacity, not setup needed", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const error = yield* Effect.flip(sessions.reserve(OTHER_AGENT, URL_ISO));
          expect(error).toMatchObject({
            _tag: "AtCapacity",
            message: "at capacity: max-jobs is 1",
            agentId: OTHER_AGENT,
          });
          expect(h.minted.finds).toEqual([]);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );

  it.effect("a second resume for an agent that already holds one is already reserved", () =>
    Effect.gen(function* () {
      const h = harness({ minted: { find: () => Option.some(MINTED) } });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT, URL_ISO);
          const error = yield* Effect.flip(sessions.reserve(AGENT, URL_ISO));
          expect(error).toMatchObject({
            _tag: "BadRequest",
            message: "already reserved",
            agentId: AGENT,
          });
          expect(h.minted.finds).toEqual([URL_ISO]);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );

  it.effect("a resume without a reservation is refused before the minted disk is looked up", () =>
    Effect.gen(function* () {
      const h = harness({ minted: { find: () => Option.some(MINTED) } });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(sessions.start(resume(), "none", false));
          expect(error).toMatchObject({ _tag: "BadRequest", message: "no reservation" });
          expect(h.minted.finds).toEqual([]);
        }),
      );
    }),
  );

  it.effect("a resumed session cannot save: its disk is a view of the minted one", () =>
    Effect.gen(function* () {
      const h = harness({ minted: { find: () => Option.some(MINTED) } });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const id = yield* sessions.start(resume(), "none", false);
          const live = yield* sessions.lookup(id, AGENT);
          const error = yield* Effect.flip(sessions.save(live));
          expect(error).toMatchObject({
            _tag: "BadRequest",
            message: "a resumed session cannot save; its disk is a view of the minted one",
            sessionId: id,
            agentId: AGENT,
          });
          // Refused before anything happened: the machine runs on, and stop still works.
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start"]);
          expect(h.minted.saves).toEqual([]);
          expect(yield* qemus(sessions)).toBe(1);
          yield* sessions.stop(live, "succeeded", "done");
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "succeeded" });
        }),
      );
    }),
  );

  it.effect(
    "a reservation the sweep takes while the minted disk is looked up is no reservation",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const h = harness({
          minted: { find: () => Effect.as(Deferred.await(gate), Option.some(MINTED)) },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.reserve(AGENT);
            const starting = yield* Effect.forkChild(
              Effect.flip(sessions.start(resume(), "none", false)),
            );
            // Ten unused minutes: the sweep gives the reservation back under the lookup.
            yield* TestClock.adjust("10 minutes");
            expect(yield* sessions.jobs).toBe(0);
            yield* Deferred.succeed(gate, undefined);
            const error = yield* Fiber.join(starting);
            expect(error).toMatchObject({ _tag: "BadRequest", message: "no reservation" });
            expect(h.sessions.sessions).toEqual([]);
            expect(h.qemu.calls).toEqual([]);
          }),
        );
      }),
  );

  it.effect("a minted overlay that fails to prepare ends the row errored as any boot failure", () =>
    Effect.gen(function* () {
      const h = harness({
        minted: { find: () => Option.some(MINTED) },
        script: {
          prepare: () =>
            Effect.fail(Errors.QemuStartError.make({ message: "qemu-img create exited 1" })),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const error = yield* Effect.flip(sessions.start(resume(), "none", false));
          expect(error).toMatchObject({
            _tag: "StartFailed",
            message: "qemu-img create exited 1",
            agentId: AGENT,
          });
          expect(h.sessions.sessions[0]).toMatchObject({
            status: "errored",
            reason: "qemu-img create exited 1",
            config: { iso: URL_ISO, mode: "resume" },
          });
          expect(h.sessions.agentRuns).toEqual([]);
          // A failed start hands the reservation back: the retry is admitted without reserving.
          expect(yield* sessions.jobs).toBe(1);
          expect(yield* Effect.flip(sessions.start(resume(), "none", false))).toMatchObject({
            _tag: "StartFailed",
          });
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
            spanNamed(h, AGENT)?.spanId,
          );
          expect(line(h, "image;")).toMatchObject({
            level: "info",
            text: `image; ${String(FakeQemu.PNG.length)} bytes in 0ms; ${url}`,
            location: id,
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
            location: id,
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
          // QEMU is still up: a failed exchange is the driver's to judge, and the session runs on.
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "running" });
          expect(yield* sessions.lookup(id, AGENT)).toBe(live);
        }),
      );
    }),
  );

  it.effect(
    "an exchange that fails because QEMU is gone ends the session errored with its debug log",
    () =>
      Effect.gen(function* () {
        const h = harness({
          script: {
            sendKey: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
            stderr: "qemu: terminating on signal 9",
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            const events = yield* sessions.follow(id);
            yield* h.qemu.exit(id, 137);
            const error = yield* Effect.flip(sessions.sendKeys(live, "a", undefined));
            expect(error).toMatchObject({ _tag: "ExchangeFailed", sessionId: id, agentId: AGENT });
            expect(h.sessions.sessions[0]).toMatchObject({
              id,
              status: "errored",
              reason: "qemu exited 137",
            });
            expect(h.debugLogs.saves).toEqual([
              { sessionId: id, serial: "", qemu: "qemu: terminating on signal 9" },
            ]);
            expect(line(h, "stopped")).toMatchObject({
              text: "stopped; errored; qemu exited 137",
              location: id,
              agentId: AGENT,
            });
            expect(yield* Stream.runCollect(events)).toEqual([
              { type: "session", status: "running" },
              { type: "action", id: 1, name: "send-keys", state: "running" },
              { type: "action", id: 1, state: "failed" },
              { type: "session", status: "errored" },
            ]);
            expect(endedWith(spanNamed(h, AGENT))).toBe("internal_error");
            expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
              _tag: "UnknownSession",
              id,
            });
            expect(yield* qemus(sessions)).toBe(0);
          }),
        );
      }),
  );

  it.effect("a screenshot or a click that fails with QEMU gone ends the session errored too", () =>
    Effect.gen(function* () {
      const h = harness({
        script: {
          screendump: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
          mouse: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const shot = yield* start();
          yield* h.qemu.exit(shot.id, 1);
          expect((yield* Effect.flip(shot.sessions.image(shot.live)))._tag).toBe("ExchangeFailed");
          const click = yield* start(OTHER_AGENT);
          yield* h.qemu.exit(click.id, 1);
          const clicked = yield* Effect.flip(
            click.sessions.mouse(click.live, { _tag: "click", x: 0.5, y: 0.5, button: "left" }),
          );
          expect(clicked._tag).toBe("ExchangeFailed");
          expect(h.sessions.sessions.map((row) => [row.id, row.status, row.reason])).toEqual([
            [shot.id, "errored", "qemu exited 1"],
            [click.id, "errored", "qemu exited 1"],
          ]);
          expect(h.debugLogs.saves).toHaveLength(2);
        }),
      );
    }),
  );

  it.effect(
    "a fresh guest that powered itself off fails the image but stays for save, which keeps its disk",
    () =>
      Effect.gen(function* () {
        const h = harness({
          script: {
            screendump: () =>
              Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            yield* h.qemu.exit(id, 0);
            expect((yield* Effect.flip(sessions.image(live)))._tag).toBe("ExchangeFailed");
            expect(h.sessions.sessions[0]).toMatchObject({ id, status: "running" });
            expect(yield* sessions.lookup(id, AGENT)).toBe(live);
            yield* sessions.save(live);
            expect(h.minted.saves).toHaveLength(1);
            expect(h.sessions.sessions[0]).toMatchObject({
              id,
              status: "succeeded",
              reason: `saved; minted ${ISO}`,
            });
          }),
        );
      }),
  );

  it.effect("a resumed guest that powered itself off still ends errored on a failed image", () =>
    Effect.gen(function* () {
      const h = harness({
        minted: {
          find: () => Option.some({ disk: `${URL_ISO}.qcow2`, vars: `${URL_ISO}.OVMF_VARS.fd` }),
        },
        script: {
          screendump: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const id = yield* sessions.start(
            Contract.StartBody.make({ iso: URL_ISO, agent: AGENT, mode: "resume" }),
            "none",
            false,
          );
          const live = yield* sessions.lookup(id, AGENT);
          yield* h.qemu.exit(id, 0);
          expect((yield* Effect.flip(sessions.image(live)))._tag).toBe("ExchangeFailed");
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "errored",
            reason: "qemu exited 0",
          });
          expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
            _tag: "UnknownSession",
          });
        }),
      );
    }),
  );

  it.effect(
    "a gone QEMU whose row cannot be closed still answers the exchange failure and logs why",
    () =>
      Effect.gen(function* () {
        const h = harness({
          script: {
            sendKey: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
          },
          sessionStore: {
            endSession: () => Effect.fail(failure("endSession", "connect ECONNREFUSED")),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            yield* h.qemu.exit(id, null);
            const error = yield* Effect.flip(sessions.sendKeys(live, "a", undefined));
            expect(error).toMatchObject({ _tag: "ExchangeFailed", sessionId: id, agentId: AGENT });
            const logged = line(h, "db: recording an errored session failed too:");
            expect(logged).toMatchObject({
              level: "error",
              text: "db: recording an errored session failed too: Failed query: endSession",
              location: id,
              agentId: AGENT,
            });
            expect(logged?.cause).toMatchObject({ _tag: "DatabaseError" });
            expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
              _tag: "UnknownSession",
            });
            expect(yield* qemus(sessions)).toBe(0);
          }),
        );
      }),
  );
});

// ---------------------------------------------------------------------------
// mouse
// ---------------------------------------------------------------------------

describe("mouse", () => {
  const OUTSIDE: ReadonlyArray<readonly [number, number]> = [
    [1.5, 0.5],
    [-0.1, 0.5],
    [0.5, 2],
  ];

  it.effect("refuses a point outside 0..1 on every operation before any exchange", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, live } = yield* start();
          const refused = (gesture: Qemu.MouseGesture) =>
            Effect.map(Effect.flip(sessions.mouse(live, gesture)), (error) => {
              expect(error).toMatchObject({
                _tag: "BadRequest",
                sessionId: live.id,
                agentId: AGENT,
              });
              return error.message;
            });
          for (const [x, y] of OUTSIDE) {
            expect(yield* refused({ _tag: "move", x, y })).toBe("mouse: x and y must be in 0..1");
            expect(yield* refused({ _tag: "click", x, y, button: "left" })).toBe(
              "mouse: x and y must be in 0..1",
            );
            expect(yield* refused({ _tag: "double-click", x, y, button: "left" })).toBe(
              "mouse: x and y must be in 0..1",
            );
            expect(yield* refused({ _tag: "scroll", x, y, direction: "down", ticks: 1 })).toBe(
              "mouse: x and y must be in 0..1",
            );
            expect(yield* refused({ _tag: "hold", x, y, button: "left" })).toBe(
              "mouse: x and y must be in 0..1",
            );
            expect(yield* refused({ _tag: "release", x, y, button: "left" })).toBe(
              "mouse: x and y must be in 0..1",
            );
            expect(
              yield* refused({
                _tag: "drag",
                from: { x, y },
                to: { x: 0.5, y: 0.5 },
                button: "left",
              }),
            ).toBe("mouse: from and to must be in 0..1");
            expect(
              yield* refused({
                _tag: "drag",
                from: { x: 0.5, y: 0.5 },
                to: { x, y },
                button: "left",
              }),
            ).toBe("mouse: from and to must be in 0..1");
          }
          for (const ticks of [0, 101, 1.5]) {
            expect(yield* refused({ _tag: "scroll", x: 0.5, y: 0.5, direction: "up", ticks })).toBe(
              "mouse: ticks must be an integer in 1..100",
            );
          }
          expect(h.qemu.calls.map((call) => call._tag)).toEqual(["prepare", "start"]);
        }),
      );
    }),
  );

  it.effect("forwards every gesture, names the action and logs it", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const events = yield* sessions.follow(id);
          const gestures: ReadonlyArray<Qemu.MouseGesture> = [
            { _tag: "move", x: 0.25, y: 0.75 },
            { _tag: "click", x: 0.5, y: 0.5, button: "left" },
            { _tag: "double-click", x: 0.5, y: 0.5, button: "left" },
            { _tag: "click", x: 0.5, y: 0.5, button: "right", modifiers: ["shift", "super"] },
            { _tag: "scroll", x: 0.5, y: 0.5, direction: "left", ticks: 3 },
            { _tag: "drag", from: { x: 0.1, y: 0.2 }, to: { x: 0.9, y: 0.2 }, button: "left" },
            { _tag: "hold", x: 0.5, y: 0.5, button: "middle" },
            { _tag: "release", x: 0.6, y: 0.6, button: "middle" },
          ];
          for (const gesture of gestures) {
            yield* sessions.mouse(live, gesture);
          }
          expect(h.qemu.calls.filter((call) => call._tag === "mouse")).toEqual(
            gestures.map((gesture) => ({ _tag: "mouse", id, gesture })),
          );
          expect(texts(h).filter((text) => text.startsWith("mouse"))).toEqual([
            "mouse move 0.25 0.75 in 0ms",
            "mouse click 0.5 0.5 left in 0ms",
            "mouse double-click 0.5 0.5 left in 0ms",
            "mouse click 0.5 0.5 right +shift +super in 0ms",
            "mouse scroll 0.5 0.5 left ×3 in 0ms",
            "mouse drag 0.1 0.2 to 0.9 0.2 left in 0ms",
            "mouse hold 0.5 0.5 middle in 0ms",
            "mouse release 0.6 0.6 middle in 0ms",
          ]);
          expect(yield* collect(events, 5)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "mouse-move", state: "running" },
            { type: "action", id: 1, state: "completed" },
            { type: "action", id: 2, name: "mouse-click", state: "running" },
            { type: "action", id: 2, state: "completed" },
          ]);
          // The fake plays one exchange per gesture; the real sequences are the qemu tests'.
          expect(
            h.actions.actions.filter(
              (row) =>
                Schema.is(Domain.QmpCommand)(row.request) &&
                row.request.execute === "input-send-event",
            ),
          ).toHaveLength(gestures.length);
        }),
      );
    }),
  );

  it.effect("a failing exchange fails ExchangeFailed", () =>
    Effect.gen(function* () {
      const h = harness({
        script: {
          mouse: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, live } = yield* start();
          const error = yield* Effect.flip(sessions.mouse(live, { _tag: "move", x: 0.5, y: 0.5 }));
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
            location: id,
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
            location: id,
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

// One Log fake whose lines share a single ordered record; `record` lets a test's own scripts
// write into the same order.
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
    flush: Effect.void,
  };
  return { order, record, layer: Layer.succeed(Log.Log)(service) };
};

describe("stop", () => {
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
          expect(h.qemu.calls.map((call) => call._tag)).toEqual([
            "prepare",
            "start",
            "stderrTail",
            "stop",
          ]);
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "aborted", reason: null });
          expect(h.sessions.sessions[0]?.endedAt).not.toBeNull();
          expect(h.sessions.agentRuns[0]?.endedAt).not.toBeNull();
          expect(ordered.order.at(-1)).toBe("stopped; aborted");
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "intent", state: "started", message: "shut the lid" },
            { type: "intent", state: "cancelled" },
            { type: "session", status: "aborted" },
          ]);
          expect(endedWith(spanNamed(h, "shut the lid"))).toBe("aborted");
          expect(spanNamed(h, "shut the lid")?.attributes.get("intent_state")).toBe("cancelled");
          expect(endedWith(spanNamed(h, AGENT))).toBe("aborted");
          expect(spanNamed(h, AGENT)?.attributes.get("session_status")).toBe("aborted");
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
            location: id,
            agentId: AGENT,
          });
          expect(endedWith(spanNamed(h, AGENT))).toBe("ok");
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
            location: id,
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
          expect(endedWith(spanNamed(h, AGENT))).toBe("deadline_exceeded");
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
          expect(h.qemu.calls.map((call) => call._tag)).toEqual([
            "prepare",
            "start",
            "stderrTail",
            "stop",
          ]);
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "aborted" },
          ]);
          expect(endedWith(spanNamed(h, AGENT))).toBe("aborted");
          expect(line(h, "stopped")).toBeUndefined();
        }),
      );
    }),
  );

  it.effect(
    "a failed stop reads serial and qemu stderr, then kills, then saves after the stopped line",
    () =>
      Effect.gen(function* () {
        const order: Array<string> = [];
        const record = (text: string) =>
          Effect.sync(() => {
            order.push(text);
          });
        let saved:
          | { readonly sessionId: string; readonly serial: string; readonly qemu: string }
          | undefined;
        const h = harness({
          script: {
            stop: () => record("kill"),
            stderrTail: () => record("qemu").pipe(Effect.as("kvm denied")),
          },
          debugLogStore: {
            saveDebugLog: (sessionId, captured) =>
              Effect.sync(() => {
                saved = { sessionId, serial: captured.serial, qemu: captured.qemu };
                order.push("save");
              }),
          },
          log: Layer.succeed(Log.Log)({
            info: record,
            warning: record,
            error: record,
            fatal: record,
            flush: record("flush"),
          }),
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            h.files.set(serialPath(h, id), Effect.succeed(SERIAL));
            yield* sessions.stop(live, "failed", "installer hung");
            expect(h.sessions.sessions[0]).toMatchObject({
              id,
              status: "failed",
              reason: "installer hung",
            });
            expect(h.fsCalls).toContain(`readFile ${serialPath(h, id)}`);
            const tail = order.slice(order.indexOf("qemu"));
            expect(tail).toEqual([
              "qemu",
              "kill",
              "stopped; failed; installer hung",
              "flush",
              "save",
            ]);
            expect(saved).toEqual({ sessionId: id, serial: "boot log\n", qemu: "kvm denied" });
          }),
        );
      }),
  );

  // A driver's succeeded is not the reviewer's: the evidence is kept for every verdict.
  it.effect("a succeeded stop writes a debug log, as an aborted stop does", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const first = yield* start();
          h.files.set(serialPath(h, first.id), Effect.succeed(SERIAL));
          yield* first.sessions.stop(first.live, "succeeded", "installed");
          expect(h.debugLogs.saves).toEqual([
            { sessionId: first.id, serial: "boot log\n", qemu: "" },
          ]);
          const second = yield* start(OTHER_AGENT);
          h.files.set(serialPath(h, second.id), Effect.succeed(SERIAL));
          yield* second.sessions.stop(second.live, undefined, "gave up");
          expect(h.debugLogs.saves).toEqual([
            { sessionId: first.id, serial: "boot log\n", qemu: "" },
            { sessionId: second.id, serial: "boot log\n", qemu: "" },
          ]);
          expect(h.sessions.sessions.map((row) => row.status)).toEqual(["succeeded", "aborted"]);
        }),
      );
    }),
  );

  it.effect(
    "the sweep's timeout reads the serial and QEMU stderr before the kill and saves after the timed out line",
    () =>
      Effect.gen(function* () {
        const order: Array<string> = [];
        const record = (text: string) =>
          Effect.sync(() => {
            order.push(text);
          });
        let saved:
          | { readonly sessionId: string; readonly serial: string; readonly qemu: string }
          | undefined;
        const h = harness({
          script: {
            stop: () => record("kill"),
            stderrTail: () => record("qemu").pipe(Effect.as("kvm denied")),
          },
          debugLogStore: {
            saveDebugLog: (sessionId, captured) =>
              Effect.sync(() => {
                saved = { sessionId, serial: captured.serial, qemu: captured.qemu };
                order.push("save");
              }),
          },
          log: Layer.succeed(Log.Log)({
            info: record,
            warning: record,
            error: record,
            fatal: record,
            flush: record("flush"),
          }),
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id } = yield* start();
            h.files.set(serialPath(h, id), Effect.succeed(SERIAL));
            yield* TestClock.adjust("10 minutes");
            expect(yield* qemus(sessions)).toBe(0);
            expect(h.sessions.sessions[0]).toMatchObject({ id, status: "timed_out" });
            expect(order.slice(order.indexOf("qemu"))).toEqual([
              "qemu",
              "kill",
              "timed out; no command received for 10 minutes",
              "flush",
              "save",
            ]);
            expect(saved).toEqual({ sessionId: id, serial: "boot log\n", qemu: "kvm denied" });
          }),
        );
      }),
  );

  it.effect("the drain saves a debug log for every session it aborts", () =>
    Effect.gen(function* () {
      const shutdown: Sessions.Shutdown = {
        reason: MutableRef.make("qemu server shutdown"),
        failed: MutableRef.make(false),
      };
      const h = harness({ shutdown });
      const ids = yield* h.run(
        Effect.gen(function* () {
          const first = yield* start(AGENT);
          const second = yield* start(OTHER_AGENT);
          h.files.set(serialPath(h, first.id), Effect.succeed(SERIAL));
          return [first.id, second.id];
        }),
      );
      expect(h.sessions.sessions.map((row) => row.status)).toEqual(["aborted", "aborted"]);
      expect(h.debugLogs.saves.map((save) => save.sessionId).sort()).toEqual([...ids].sort());
      // The second session has no console file: an empty serial, still saved.
      expect(h.debugLogs.saves.find((save) => save.sessionId === ids[0])?.serial).toBe(
        "boot log\n",
      );
      expect(h.debugLogs.saves.find((save) => save.sessionId === ids[1])?.serial).toBe("");
    }),
  );

  it.effect("a missing serial still writes a debug log and the stop succeeds", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* sessions.stop(live, "failed", "desktop dead");
          expect(h.debugLogs.saves).toEqual([{ sessionId: id, serial: "", qemu: "" }]);
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "failed" });
          expect(line(h, "debug log:")).toBeUndefined();
        }),
      );
    }),
  );

  it.effect("a serial the host cannot read is logged and the debug log is still saved", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          h.files.set(serialPath(h, id), Effect.fail(denied("readFile", serialPath(h, id))));
          yield* sessions.stop(live, "failed", "gave up");
          expect(h.debugLogs.saves).toEqual([{ sessionId: id, serial: "", qemu: "" }]);
          expect(line(h, "debug log: serial read failed:")).toMatchObject({
            level: "error",
            location: id,
            agentId: AGENT,
            skipSentry: false,
          });
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "failed" });
        }),
      );
    }),
  );

  it.effect("a debug log that cannot be saved is logged and the stop still closes", () =>
    Effect.gen(function* () {
      const h = harness({
        debugLogStore: {
          saveDebugLog: () => Effect.fail(failure("saveDebugLog", "connect ECONNREFUSED")),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          h.files.set(serialPath(h, id), Effect.succeed(SERIAL));
          yield* sessions.stop(live, "failed", "gave up");
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "failed", reason: "gave up" });
          expect(line(h, "debug log save failed:")).toMatchObject({
            level: "error",
            text: "debug log save failed: connect ECONNREFUSED",
            location: id,
            agentId: AGENT,
            skipSentry: false,
          });
          expect(line(h, "stopped")).toMatchObject({ text: "stopped; failed; gave up" });
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe("save", () => {
  const tags = (h: Harness): ReadonlyArray<string> => h.qemu.calls.map((call) => call._tag);

  it.effect(
    "powers the guest down, keeps its disk before the kill, closes the row succeeded and tells followers last",
    () =>
      Effect.gen(function* () {
        const ordered = orderedLog();
        const h = harness({
          log: ordered.layer,
          script: { stop: () => ordered.record("kill") },
          minted: { save: () => ordered.record("minted") },
        });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            h.files.set(serialPath(h, id), Effect.succeed(SERIAL));
            const events = yield* sessions.follow(id);
            yield* sessions.save(live);
            expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
              _tag: "UnknownSession",
            });
            expect(yield* qemus(sessions)).toBe(0);
            expect(yield* sessions.jobs).toBe(0);
            // The console and the stderr tail are read before the kill takes the session dir.
            expect(tags(h)).toEqual(["prepare", "start", "powerdown", "stderrTail", "stop"]);
            expect(h.minted.saves).toEqual([
              {
                iso: ISO,
                from: {
                  disk: `${h.qemu.sessionDir(id)}/disk.qcow2`,
                  vars: `${h.qemu.sessionDir(id)}/OVMF_VARS.fd`,
                },
                who: { sessionId: id, agentId: AGENT },
              },
            ]);
            expect(h.actions.actions[1]).toMatchObject({
              request: { execute: "system_powerdown", arguments: {} },
              state: "completed",
            });
            expect(h.sessions.sessions[0]).toMatchObject({
              id,
              status: "succeeded",
              reason: `saved; minted ${ISO}`,
            });
            expect(h.sessions.sessions[0]?.endedAt).not.toBeNull();
            expect(h.sessions.agentRuns[0]?.endedAt).not.toBeNull();
            // The disk is read while the session dir still exists; the kill comes after.
            expect(ordered.order.slice(ordered.order.indexOf("minted"))).toEqual([
              "minted",
              "kill",
              `saved; minted ${ISO}`,
            ]);
            expect(yield* Stream.runCollect(events)).toEqual([
              { type: "session", status: "running" },
              { type: "action", id: 1, name: "save", state: "running" },
              { type: "action", id: 1, state: "completed" },
              { type: "session", status: "succeeded" },
            ]);
            expect(endedWith(spanNamed(h, AGENT))).toBe("ok");
            expect(h.debugLogs.saves).toEqual([{ sessionId: id, serial: "boot log\n", qemu: "" }]);
          }),
        );
      }),
  );

  it.effect("a guest that already left is kept without a powerdown exchange", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* h.qemu.exit(id, 0);
          yield* sessions.save(live);
          expect(tags(h)).toEqual(["prepare", "start", "stderrTail", "stop"]);
          expect(h.actions.actions).toHaveLength(1);
          expect(h.minted.saves).toHaveLength(1);
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "succeeded" });
        }),
      );
    }),
  );

  it.effect("a debug log that cannot be saved is logged and the save still succeeds", () =>
    Effect.gen(function* () {
      const h = harness({
        debugLogStore: {
          saveDebugLog: () => Effect.fail(failure("saveDebugLog", "connect ECONNREFUSED")),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* sessions.save(live);
          expect(h.minted.saves).toHaveLength(1);
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "succeeded",
            reason: `saved; minted ${ISO}`,
          });
          expect(line(h, "debug log save failed:")).toMatchObject({
            level: "error",
            text: "debug log save failed: connect ECONNREFUSED",
            location: id,
            agentId: AGENT,
          });
          expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
            _tag: "UnknownSession",
          });
        }),
      );
    }),
  );

  it.effect("a socket that closes under the powerdown is a guest already leaving", () =>
    Effect.gen(function* () {
      const h = harness({
        script: {
          powerdown: () => Effect.fail(Errors.QmpClosed.make({ message: "qemu: closed" })),
          powersOff: false,
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const saving = yield* Effect.forkChild(sessions.save(live));
          yield* Effect.yieldNow;
          expect(h.minted.saves).toEqual([]);
          yield* h.qemu.exit(id, 0);
          yield* Fiber.join(saving);
          expect(h.minted.saves).toHaveLength(1);
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "succeeded" });
        }),
      );
    }),
  );

  it.effect(
    "a guest that does not power off within two minutes is killed, the row errors and nothing is kept",
    () =>
      Effect.gen(function* () {
        const h = harness({ script: { powersOff: false } });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id, live } = yield* start();
            const events = yield* sessions.follow(id);
            const saving = yield* Effect.forkChild(Effect.flip(sessions.save(live)));
            yield* TestClock.adjust("2 minutes");
            const error = yield* Fiber.join(saving);
            expect(error).toMatchObject({
              _tag: "SaveFailed",
              message: "guest did not power off within 2 minutes",
              sessionId: id,
              agentId: AGENT,
            });
            expect(h.minted.saves).toEqual([]);
            expect(tags(h)).toEqual(["prepare", "start", "powerdown", "stderrTail", "stop"]);
            expect(h.sessions.sessions[0]).toMatchObject({
              id,
              status: "errored",
              reason: "guest did not power off within 2 minutes",
            });
            expect(h.debugLogs.saves).toEqual([{ sessionId: id, serial: "", qemu: "" }]);
            expect(yield* qemus(sessions)).toBe(0);
            expect(yield* sessions.jobs).toBe(0);
            expect(yield* Stream.runCollect(events)).toEqual([
              { type: "session", status: "running" },
              { type: "action", id: 1, name: "save", state: "running" },
              { type: "action", id: 1, state: "failed" },
              { type: "session", status: "errored" },
            ]);
            expect(endedWith(spanNamed(h, AGENT))).toBe("internal_error");
            expect(line(h, "stopped")).toMatchObject({
              text: "stopped; errored; guest did not power off within 2 minutes",
              location: id,
              agentId: AGENT,
            });
          }),
        );
      }),
  );

  it.effect("a powerdown QEMU refuses fails the save with QEMU's reason", () =>
    Effect.gen(function* () {
      const raw = { error: { class: "GenericError", desc: "no ACPI" }, id: 2 };
      const h = harness({
        script: {
          powerdown: () =>
            Effect.fail(
              Errors.QmpError.make({
                command: "system_powerdown",
                class: "GenericError",
                desc: "no ACPI",
                raw,
              }),
            ),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const error = yield* Effect.flip(sessions.save(live));
          expect(error).toMatchObject({
            _tag: "SaveFailed",
            message: "GenericError: no ACPI",
            sessionId: id,
            agentId: AGENT,
          });
          expect(h.actions.actions[1]).toMatchObject({ state: "failed", response: raw });
          expect(h.minted.saves).toEqual([]);
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "errored",
            reason: "GenericError: no ACPI",
          });
          expect(h.debugLogs.saves).toHaveLength(1);
        }),
      );
    }),
  );

  it.effect("a disk that cannot be kept fails the save and the row says why", () =>
    Effect.gen(function* () {
      const h = harness({
        minted: {
          save: ({ who }) =>
            Effect.fail(
              ApiErrors.SaveFailed.make({
                message: "qemu-img convert exited 1",
                sessionId: who.sessionId,
                agentId: who.agentId,
              }),
            ),
        },
      });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          const error = yield* Effect.flip(sessions.save(live));
          expect(error).toMatchObject({
            _tag: "SaveFailed",
            message: "qemu-img convert exited 1",
            sessionId: id,
            agentId: AGENT,
          });
          expect(tags(h)).toEqual(["prepare", "start", "powerdown", "stderrTail", "stop"]);
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "errored",
            reason: "qemu-img convert exited 1",
          });
          expect(h.debugLogs.saves).toHaveLength(1);
          expect(yield* sessions.jobs).toBe(0);
        }),
      );
    }),
  );

  it.effect("a save racing the sweep is unknown session: the session gets one verdict", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id, live } = yield* start();
          yield* TestClock.adjust("10 minutes");
          const error = yield* Effect.flip(sessions.save(live));
          expect(error).toMatchObject({ _tag: "UnknownSession", id, agentId: AGENT });
          expect(h.minted.saves).toEqual([]);
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "timed_out" });
        }),
      );
    }),
  );

  it.effect("a record that cannot be closed fails Internal after the disk is kept", () =>
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
          const error = yield* Effect.flip(sessions.save(live));
          expect(error).toMatchObject({ _tag: "Internal", sessionId: id, agentId: AGENT });
          expect(h.minted.saves).toHaveLength(1);
          expect(tags(h)).toEqual(["prepare", "start", "powerdown", "stderrTail", "stop"]);
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "action", id: 1, name: "save", state: "running" },
            { type: "action", id: 1, state: "completed" },
            { type: "session", status: "succeeded" },
          ]);
          expect(line(h, "saved")).toBeUndefined();
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
            const booting = yield* Effect.forkChild(reservedStart(startBody()), {
              startImmediately: true,
            });
            const id = h.sessions.sessions[0]?.id ?? "";
            expect(Domain.isSessionId(id)).toBe(true);
            const early = yield* sessions.follow(id);
            expect(yield* collect(early, 1)).toEqual([{ type: "session", status: "pending" }]);
            expect(line(h, "follower attached")).toMatchObject({ location: id, agentId: AGENT });
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

  it.effect("refuses unknown ids and sessions this qemu server does not hold", () =>
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
            message: `session "${UNKNOWN_ID}" is not running on this qemu server`,
            sessionId: UNKNOWN_ID,
          });
          expect(
            yield* Effect.flip(sessions.follow("2baaad43-674b-4bdb-88d7-3f18fce50aba")),
          ).toMatchObject({
            _tag: "Conflict",
            message: `session "2baaad43-674b-4bdb-88d7-3f18fce50aba" is not running on this qemu server`,
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
            location: id,
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
          expect(h.qemu.calls.map((call) => call._tag)).toEqual([
            "prepare",
            "start",
            "stderrTail",
            "stop",
          ]);
          expect(h.sessions.sessions[0]).toMatchObject({
            id,
            status: "timed_out",
            reason: "no command received for 10 minutes",
          });
          expect(line(h, "timed out")).toMatchObject({
            level: "info",
            text: "timed out; no command received for 10 minutes",
            location: id,
            agentId: undefined,
          });
          expect(endedWith(spanNamed(h, AGENT))).toBe("deadline_exceeded");
          expect(spanNamed(h, AGENT)?.attributes.get("session_status")).toBe("timed_out");
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "timed_out" },
          ]);
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
            location: id,
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
            location: id,
          });
          expect(logged?.cause).toMatchObject({ _tag: "DatabaseError" });
          expect(line(h, "timed out")).toBeUndefined();
          expect(yield* Stream.runCollect(events)).toEqual([
            { type: "session", status: "running" },
            { type: "session", status: "timed_out" },
          ]);
          expect(endedWith(spanNamed(h, AGENT))).toBe("deadline_exceeded");
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
        reason: MutableRef.make("qemu server shutdown"),
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
        "stderrTail",
        "stop",
        "stderrTail",
        "stop",
      ]);
      expect(h.sessions.sessions.map((row) => [row.status, row.reason])).toEqual([
        ["aborted", "qemu server shutdown"],
        ["aborted", "qemu server shutdown"],
      ]);
      const drainLines = h.log.lines.filter(
        (entry) => entry.text.startsWith("qemu server:") || entry.text.startsWith("stopped"),
      );
      expect(drainLines[0]).toMatchObject({
        level: "info",
        text: "qemu server: shutting down; stopping 2 sessions",
        location: "server",
        agentId: undefined,
      });
      expect(drainLines.slice(1).map((entry) => entry.text)).toEqual([
        "stopped; aborted; qemu server shutdown",
        "stopped; aborted; qemu server shutdown",
      ]);
      expect(new Set(drainLines.slice(1).map((entry) => entry.location))).toEqual(
        new Set(drained.ids),
      );
      expect(drainLines.slice(1).every((entry) => entry.agentId === undefined)).toBe(true);
      expect(yield* Fiber.join(drained.reader)).toEqual([
        { type: "session", status: "running" },
        { type: "session", status: "aborted" },
      ]);
      expect(
        h.tracer.spans
          .filter((span) => span.attributes.get("sentry.op") === "qemu.session")
          .map((span) => [span.name, endedWith(span)]),
      ).toEqual([
        [AGENT, "aborted"],
        [OTHER_AGENT, "aborted"],
      ]);
      expect(MutableRef.get(shutdown.failed)).toBe(false);
    }),
  );

  it.effect("reads the reason the server error path sets", () =>
    Effect.gen(function* () {
      const shutdown: Sessions.Shutdown = {
        reason: MutableRef.make("qemu server shutdown"),
        failed: MutableRef.make(false),
      };
      const h = harness({ shutdown });
      yield* h.run(
        Effect.gen(function* () {
          yield* start();
          MutableRef.set(shutdown.reason, "qemu server error: listen EADDRINUSE");
        }),
      );
      expect(h.sessions.sessions[0]).toMatchObject({
        status: "aborted",
        reason: "qemu server error: listen EADDRINUSE",
      });
      expect(texts(h).slice(-2)).toEqual([
        "qemu server: shutting down; stopping 1 sessions",
        "stopped; aborted; qemu server error: listen EADDRINUSE",
      ]);
    }),
  );

  it.effect("sessions that cannot be closed mark the shutdown failed", () =>
    Effect.gen(function* () {
      const shutdown: Sessions.Shutdown = {
        reason: MutableRef.make("qemu server shutdown"),
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
        { level: "error", text: "shutdown: Failed query: endSession", location: ids[0] },
        { level: "error", text: "shutdown: rm failed", location: ids[1] },
      ]);
      expect(logged[0]?.cause).toMatchObject({ _tag: "DatabaseError" });
      expect(logged[1]?.cause).toBeInstanceOf(Error);
      expect(texts(h).filter((text) => text.startsWith("stopped"))).toEqual([
        "stopped; aborted; qemu server shutdown",
      ]);
      expect(h.qemu.calls.filter((call) => call._tag === "stop")).toHaveLength(3);
      // The machine that would not die never reaches the row close.
      expect(ended.sort()).toEqual([ids[0], ids[2]].sort());
      // A killed machine whose row would not close still ended aborted; one that would not die
      // ended failed.
      const spans = h.tracer.spans.filter(
        (span) => span.attributes.get("sentry.op") === "qemu.session",
      );
      expect(
        spans.map((span) => [span.name, span.attributes.get("session_id"), endedWith(span)]),
      ).toEqual([
        [AGENT, ids[0], "aborted"],
        [OTHER_AGENT, ids[1], "internal_error"],
        ["OLI-63", ids[2], "aborted"],
      ]);
    }),
  );

  it.effect("with nothing running it only announces itself", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* h.run(Effect.asVoid(Sessions.Sessions));
      expect(texts(h)).toEqual(["qemu server: shutting down; stopping 0 sessions"]);
      expect(h.qemu.calls).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// restart
// ---------------------------------------------------------------------------

const SELF = "http://10.0.0.5:42069";
const ELSEWHERE = "http://10.0.0.6:42069";
const RESTARTED = "qemu server restarted";

type SessionRow = Stores.FakeSessionStore["sessions"][number];

// A row a qemu server wrote before it died, routed to `url` by the qemu reverse proxy.
const seedSession = (
  h: Harness,
  status: SessionRow["status"],
  url: string | undefined,
  agent?: string,
): string => {
  const id = crypto.randomUUID();
  const over = status !== "downloading" && status !== "running";
  h.sessions.sessions.push({
    id,
    config: { iso: ISO },
    status,
    reason: over ? "done" : null,
    startedAt: new Date(),
    endedAt: over ? new Date() : null,
  });
  if (url !== undefined) {
    h.sessions.routes.set(id, url);
  }
  if (agent !== undefined) {
    h.sessions.agentRuns.push({
      agentId: agent,
      sessionId: id,
      startedAt: new Date(),
      endedAt: null,
    });
  }
  return id;
};

const rowOf = (h: Harness, id: string): SessionRow | undefined =>
  h.sessions.sessions.find((row) => row.id === id);

describe("restart", () => {
  it.effect(
    "errors the sessions still downloading or running on this url, ends their agent runs, and leaves every other row alone",
    () =>
      Effect.gen(function* () {
        const h = harness({ selfUrl: SELF });
        const downloading = seedSession(h, "downloading", SELF);
        const running = seedSession(h, "running", SELF, AGENT);
        const finished = seedSession(h, "succeeded", SELF);
        const elsewhere = seedSession(h, "running", ELSEWHERE, OTHER_AGENT);
        const unrouted = seedSession(h, "running", undefined);
        // What a driver following the lost session reads now: a finished session.
        const followed = yield* h.run(
          Effect.flatMap(Sessions.Sessions, (sessions) => Effect.flip(sessions.follow(running))),
        );
        expect(followed).toMatchObject({
          _tag: "Conflict",
          message: `session "${running}" has already completed (errored)`,
        });
        for (const id of [downloading, running]) {
          expect(rowOf(h, id)).toMatchObject({
            status: "errored",
            reason: RESTARTED,
            endedAt: expect.any(Date),
          });
        }
        expect(rowOf(h, finished)).toMatchObject({ status: "succeeded", reason: "done" });
        expect(rowOf(h, elsewhere)).toMatchObject({ status: "running", endedAt: null });
        expect(rowOf(h, unrouted)).toMatchObject({ status: "running", endedAt: null });
        expect(h.sessions.agentRuns.map((run) => [run.agentId, run.endedAt !== null])).toEqual([
          [AGENT, true],
          [OTHER_AGENT, false],
        ]);
        expect(h.log.lines.filter((entry) => entry.level === "error")).toEqual([
          {
            level: "error",
            text: `errored; ${RESTARTED}`,
            location: downloading,
            agentId: undefined,
            skipSentry: false,
            cause: undefined,
          },
          {
            level: "error",
            text: `errored; ${RESTARTED}`,
            location: running,
            agentId: undefined,
            skipSentry: false,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect(
    "a cleanup that cannot write fails the qemu server's startup, and no session starts",
    () =>
      Effect.gen(function* () {
        const h = harness({
          selfUrl: SELF,
          sessionStore: {
            failRoutedSessions: () =>
              Effect.fail(failure("failRoutedSessions", "connect ECONNREFUSED")),
          },
        });
        const left = seedSession(h, "running", SELF);
        const error = yield* Effect.flip(h.run(start()));
        expect(error).toMatchObject({ _tag: "DatabaseError", operation: "failRoutedSessions" });
        expect(h.sessions.sessions.map((row) => [row.id, row.status])).toEqual([[left, "running"]]);
        expect(h.qemu.calls).toEqual([]);
      }),
  );

  it.effect("a qemu server with no url of its own closes no rows", () =>
    Effect.gen(function* () {
      const h = harness();
      const left = seedSession(h, "running", SELF, AGENT);
      yield* h.run(Effect.asVoid(Sessions.Sessions));
      expect(rowOf(h, left)).toMatchObject({ status: "running", endedAt: null });
      expect(h.sessions.agentRuns[0]?.endedAt).toBeNull();
      expect(h.log.lines.filter((entry) => entry.level === "error")).toEqual([]);
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

// ---------------------------------------------------------------------------
// minted
// ---------------------------------------------------------------------------

describe("minted", () => {
  const FILES = { disk: `${ISO}.qcow2`, vars: `${ISO}.OVMF_VARS.fd` };

  it.effect(
    "answers whether this machine holds the iso's minted disk, asking Minted by the iso as given (happy and unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness({
          minted: { find: (iso) => (iso === ISO ? Option.some(FILES) : Option.none()) },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            expect(yield* sessions.minted(ISO)).toBe(true);
            // Any name is a fair question; one nothing was ever saved under is simply not minted.
            expect(yield* sessions.minted("poophead.iso")).toBe(false);
          }),
        );
        expect(h.minted.finds).toEqual([ISO, "poophead.iso"]);
      }),
  );
});

describe("jobs", () => {
  it.effect(
    "reports the current admitted count, including a reservation that has not started",
    () =>
      Effect.gen(function* () {
        const h = harness({ maxJobs: 2 });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            expect(yield* sessions.jobs).toBe(0);
            yield* sessions.reserve(AGENT);
            expect(yield* sessions.jobs).toBe(1);
            const { live } = yield* start(OTHER_AGENT);
            expect(yield* sessions.jobs).toBe(2);
            yield* sessions.stop(live, "succeeded", "done");
            expect(yield* sessions.jobs).toBe(1);
            yield* sessions.relinquish(AGENT);
            expect(yield* sessions.jobs).toBe(0);
          }),
        );
      }),
  );

  it.effect("a refused reserve does not count (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          expect(yield* sessions.jobs).toBe(1);
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// capacity
// ---------------------------------------------------------------------------

describe("capacity", () => {
  it.effect("a reserve past --max-jobs is AtCapacity before anything is minted or written", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const error = yield* Effect.flip(sessions.reserve(OTHER_AGENT));
          expect(error).toMatchObject({
            _tag: "AtCapacity",
            message: "at capacity: max-jobs is 1",
            agentId: OTHER_AGENT,
          });
          expect(h.sessions.sessions).toEqual([]);
          expect(h.sessions.agentRuns).toEqual([]);
          expect(h.iso.calls).toHaveLength(0);
          expect(h.qemu.calls).toEqual([]);
          expect(spanNamed(h, OTHER_AGENT)).toBeUndefined();
          expect(texts(h)).toEqual([]);
          expect(yield* qemus(sessions)).toBe(0);
        }),
      );
    }),
  );

  it.effect("a second reserve for the same agent is already reserved", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          const error = yield* Effect.flip(sessions.reserve(AGENT));
          expect(error).toMatchObject({
            _tag: "BadRequest",
            message: "already reserved",
            agentId: AGENT,
          });
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
        }),
      );
    }),
  );

  it.effect("start after reserve does not take a second slot and still boots", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const { id } = yield* start();
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
          expect(h.sessions.sessions.map((row) => row.id)).toEqual([id]);
          expect(yield* qemus(sessions)).toBe(1);
        }),
      );
    }),
  );

  it.effect(
    "a start without a reservation is BadRequest before anything is minted or written",
    () =>
      Effect.gen(function* () {
        const h = harness({ maxJobs: 1 });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const error = yield* Effect.flip(sessions.start(startBody(), "none", false));
            expect(error).toMatchObject({
              _tag: "BadRequest",
              message: "no reservation",
              agentId: AGENT,
            });
            expect(h.sessions.sessions).toEqual([]);
            expect(h.sessions.agentRuns).toEqual([]);
            expect(h.iso.calls).toHaveLength(0);
            expect(h.qemu.calls).toEqual([]);
            expect(spanNamed(h, AGENT)).toBeUndefined();
            expect(texts(h)).toEqual([]);
            expect(yield* qemus(sessions)).toBe(0);
          }),
        );
      }),
  );

  it.effect("a booting session holds its slot until it is running", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const h = harness({ maxJobs: 1, script: { boot: () => Deferred.await(gate) } });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const booting = yield* Effect.forkChild(reservedStart(startBody()), {
            startImmediately: true,
          });
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
          yield* Deferred.succeed(gate, undefined);
          const id = yield* Fiber.join(booting);
          expect(h.sessions.sessions.map((row) => row.id)).toEqual([id]);
          expect(yield* qemus(sessions)).toBe(1);
        }),
      );
    }),
  );

  it.effect("a stopped session frees its slot", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, live } = yield* start();
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
          yield* sessions.stop(live, "succeeded", "done");
          const next = yield* reservedStart(startBody(ISO, OTHER_AGENT));
          expect(h.sessions.sessions.map((row) => [row.id, row.status])).toEqual([
            [live.id, "succeeded"],
            [next, "running"],
          ]);
          expect(yield* qemus(sessions)).toBe(1);
        }),
      );
    }),
  );

  it.effect(
    "a start that fails to boot or to insert its row hands the slot back to its agent as the reservation it was",
    () =>
      Effect.gen(function* () {
        let boots = 0;
        let inserts = 0;
        const h = harness({
          maxJobs: 1,
          script: {
            boot: () =>
              Effect.suspend(() =>
                ++boots === 1
                  ? Effect.fail(Errors.QemuStartError.make({ message: "qemu: exited 1" }))
                  : Effect.void,
              ),
          },
          sessionStore: {
            insertSession: () =>
              Effect.suspend(() =>
                ++inserts === 2
                  ? Effect.fail(failure("insertSession", "connect ECONNREFUSED"))
                  : Effect.void,
              ),
          },
        });
        // A boot failure spends the agent's one registration, so every start names a new agent;
        // the slot stays with the agent whose start failed until that agent gives it back.
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const booted = yield* Effect.flip(reservedStart(startBody(ISO, AGENT)));
            expect(booted._tag).toBe("StartFailed");
            expect(yield* sessions.jobs).toBe(1);
            expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
            yield* sessions.relinquish(AGENT);
            expect(yield* sessions.jobs).toBe(0);
            const inserted = yield* Effect.flip(reservedStart(startBody(ISO, OTHER_AGENT)));
            expect(inserted._tag).toBe("Internal");
            expect(yield* sessions.jobs).toBe(1);
            expect((yield* Effect.flip(sessions.reserve("OLI-63")))._tag).toBe("AtCapacity");
            yield* sessions.relinquish(OTHER_AGENT);
            const id = yield* reservedStart(startBody(ISO, "OLI-63"));
            expect(Domain.isSessionId(id)).toBe(true);
            expect(yield* qemus(sessions)).toBe(1);
            expect((yield* Effect.flip(sessions.reserve("OLI-64")))._tag).toBe("AtCapacity");
          }),
        );
      }),
  );

  it.effect("a timed-out session frees its slot", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const { sessions, id } = yield* start();
          yield* TestClock.adjust("10 minutes");
          expect(h.sessions.sessions[0]).toMatchObject({ id, status: "timed_out" });
          const next = yield* reservedStart(startBody(ISO, OTHER_AGENT));
          expect(next).not.toBe(id);
          expect(yield* qemus(sessions)).toBe(1);
        }),
      );
    }),
  );

  it.effect("relinquish gives back an unused reservation so another agent can take it", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
          yield* sessions.relinquish(AGENT);
          yield* sessions.reserve(OTHER_AGENT);
          expect((yield* Effect.flip(sessions.reserve(AGENT)))._tag).toBe("AtCapacity");
          expect(h.sessions.sessions).toEqual([]);
          expect(yield* qemus(sessions)).toBe(0);
        }),
      );
    }),
  );

  it.effect("relinquish without a reservation is BadRequest", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const error = yield* Effect.flip(sessions.relinquish(AGENT));
          expect(error).toMatchObject({
            _tag: "BadRequest",
            message: "no reservation",
            agentId: AGENT,
          });
          yield* sessions.reserve(AGENT);
          expect((yield* Effect.flip(sessions.relinquish(OTHER_AGENT)))._tag).toBe("BadRequest");
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
        }),
      );
    }),
  );

  it.effect(
    "relinquish after start stops the running session as aborted; relinquished, closing the machine, the record and the slot",
    () =>
      Effect.gen(function* () {
        const h = harness({ maxJobs: 1 });
        yield* h.run(
          Effect.gen(function* () {
            const { sessions, id } = yield* start();
            const events = yield* sessions.follow(id);
            yield* sessions.relinquish(AGENT);
            expect(yield* Effect.flip(sessions.lookup(id, AGENT))).toMatchObject({
              _tag: "UnknownSession",
            });
            expect(yield* qemus(sessions)).toBe(0);
            expect(yield* sessions.jobs).toBe(0);
            expect(h.qemu.calls.map((call) => call._tag)).toEqual([
              "prepare",
              "start",
              "stderrTail",
              "stop",
            ]);
            expect(h.sessions.sessions[0]).toMatchObject({
              id,
              status: "aborted",
              reason: "relinquished",
            });
            expect(h.sessions.sessions[0]?.endedAt).not.toBeNull();
            expect(h.debugLogs.saves.map((save) => save.sessionId)).toEqual([id]);
            expect(texts(h).at(-1)).toBe("stopped; aborted; relinquished");
            expect(yield* Stream.runCollect(events)).toEqual([
              { type: "session", status: "running" },
              { type: "session", status: "aborted" },
            ]);
            expect(endedWith(spanNamed(h, AGENT))).toBe("aborted");
            // Nothing left to give back: the slot is the next agent's.
            expect(yield* Effect.flip(sessions.relinquish(AGENT))).toMatchObject({
              _tag: "BadRequest",
              message: "no reservation",
              agentId: AGENT,
            });
            yield* sessions.reserve(OTHER_AGENT);
          }),
        );
      }),
  );

  it.effect(
    "relinquish gives back a reservation and stops a running session held together, in one call",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const h = harness({ maxJobs: 2, script: { boot: () => Deferred.await(gate) } });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const booting = yield* Effect.forkChild(reservedStart(startBody()), {
              startImmediately: true,
            });
            // A reserve landing mid-start is admitted beside the session (see failed start).
            yield* sessions.reserve(AGENT);
            yield* Deferred.succeed(gate, undefined);
            const id = yield* Fiber.join(booting);
            expect(yield* sessions.jobs).toBe(2);
            yield* sessions.relinquish(AGENT);
            expect(yield* sessions.jobs).toBe(0);
            expect(yield* qemus(sessions)).toBe(0);
            expect(h.sessions.sessions.map((row) => [row.id, row.status, row.reason])).toEqual([
              [id, "aborted", "relinquished"],
            ]);
            yield* sessions.reserve(OTHER_AGENT);
            yield* sessions.reserve("OLI-63");
          }),
        );
      }),
  );

  it.effect(
    "a relinquish whose record cannot be closed fails Internal after the session is finished (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness({
          maxJobs: 1,
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
            const { sessions, id } = yield* start();
            const error = yield* Effect.flip(sessions.relinquish(AGENT));
            expect(error).toMatchObject({
              _tag: "Internal",
              message: "internal error",
              sessionId: id,
              agentId: AGENT,
            });
            // The machine is gone and the slot is free; only the row stayed open.
            expect(h.qemu.calls.map((call) => call._tag)).toContain("stop");
            expect(yield* qemus(sessions)).toBe(0);
            expect(yield* sessions.jobs).toBe(0);
            expect(h.sessions.sessions[0]).toMatchObject({ id, status: "running" });
            yield* sessions.reserve(OTHER_AGENT);
          }),
        );
      }),
  );

  it.effect(
    "relinquish while the agent's start is in flight is BadRequest and the boot keeps its slot (unhappy)",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const h = harness({ maxJobs: 1, script: { boot: () => Deferred.await(gate) } });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const booting = yield* Effect.forkChild(reservedStart(startBody()), {
              startImmediately: true,
            });
            expect(yield* Effect.flip(sessions.relinquish(AGENT))).toMatchObject({
              _tag: "BadRequest",
              message: "no reservation",
              agentId: AGENT,
            });
            expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
            yield* Deferred.succeed(gate, undefined);
            const id = yield* Fiber.join(booting);
            expect(h.sessions.sessions.map((row) => [row.id, row.status])).toEqual([
              [id, "running"],
            ]);
            expect(yield* qemus(sessions)).toBe(1);
          }),
        );
      }),
  );
});

// ---------------------------------------------------------------------------
// failed start
// ---------------------------------------------------------------------------

// A start that fails hands the reservation back as it was: the slot was the agent's before the
// start and stays so, so the retry is admitted rather than refused as "no reservation" (OLI-1309:
// one refused database connection cost a driver its counted slot).
describe("failed start", () => {
  it.effect(
    "a start refused at the session insert keeps its reservation: the retry is admitted with no new reserve",
    () =>
      Effect.gen(function* () {
        let inserts = 0;
        const h = harness({
          maxJobs: 1,
          sessionStore: {
            insertSession: () =>
              Effect.suspend(() =>
                ++inserts === 1
                  ? Effect.fail(failure("insertSession", SLOTS_REFUSED))
                  : Effect.void,
              ),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const refused = yield* Effect.flip(reservedStart(startBody()));
            expect(refused).toMatchObject({
              _tag: "Internal",
              message: "internal error",
              agentId: AGENT,
            });
            // Still this agent's reservation, not merely a free slot.
            expect(yield* sessions.jobs).toBe(1);
            expect(yield* Effect.flip(sessions.reserve(AGENT))).toMatchObject({
              _tag: "BadRequest",
              message: "already reserved",
              agentId: AGENT,
            });
            expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
            const id = yield* sessions.start(startBody(), "none", false);
            expect(Domain.isSessionId(id)).toBe(true);
            expect(yield* sessions.jobs).toBe(1);
            expect(yield* qemus(sessions)).toBe(1);
            expect(h.sessions.agentRuns).toMatchObject([{ agentId: AGENT, sessionId: id }]);
            expect(texts(h)).toEqual([`starting; iso ${ISO}`, "running; started in 0ms"]);
          }),
        );
      }),
  );

  it.effect(
    "a start refused at the agent's registration ends its row errored with the detail and the retry boots",
    () =>
      Effect.gen(function* () {
        let registrations = 0;
        const runs: Array<{ readonly agentId: string; readonly sessionId: string }> = [];
        const h = harness({
          maxJobs: 1,
          sessionStore: {
            registerAgent: (agentId, sessionId) =>
              Effect.suspend(() =>
                ++registrations === 1
                  ? Effect.fail(failure("registerAgent", SLOTS_REFUSED))
                  : Effect.sync(() => {
                      runs.push({ agentId, sessionId });
                    }),
              ),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const refused = yield* Effect.flip(reservedStart(startBody()));
            expect(refused).toMatchObject({
              _tag: "StartFailed",
              message: SLOTS_REFUSED,
              agentId: AGENT,
            });
            expect(yield* sessions.jobs).toBe(1);
            expect(yield* qemus(sessions)).toBe(0);
            const id = yield* sessions.start(startBody(), "none", false);
            expect(h.sessions.sessions.map((row) => [row.status, row.reason])).toEqual([
              ["errored", SLOTS_REFUSED],
              ["running", null],
            ]);
            expect(runs).toEqual([{ agentId: AGENT, sessionId: id }]);
            expect(yield* sessions.jobs).toBe(1);
            expect(yield* qemus(sessions)).toBe(1);
            expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
          }),
        );
      }),
  );

  it.effect(
    "a kept reservation still counts against max-jobs and expires on its original deadline (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness({
          maxJobs: 1,
          sessionStore: {
            insertSession: () => Effect.fail(failure("insertSession", SLOTS_REFUSED)),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.reserve(AGENT);
            yield* TestClock.adjust("5 minutes");
            expect((yield* Effect.flip(sessions.start(startBody(), "none", false)))._tag).toBe(
              "Internal",
            );
            expect(yield* sessions.jobs).toBe(1);
            expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
            // Ten minutes after the reserve, five after the failure: the deadline is the
            // reservation's own, not the failed start's.
            yield* TestClock.adjust("5 minutes");
            expect(yield* sessions.jobs).toBe(0);
            expect(yield* Effect.flip(sessions.start(startBody(), "none", false))).toMatchObject({
              _tag: "BadRequest",
              message: "no reservation",
              agentId: AGENT,
            });
            yield* sessions.reserve(OTHER_AGENT);
            expect(yield* qemus(sessions)).toBe(0);
            expect(texts(h)).toEqual(["reservation expired; unused for 10 minutes"]);
          }),
        );
      }),
  );

  it.effect(
    "a reserve for the same agent that lands mid-start stands: the failed start gives only its own slot up (unhappy)",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const h = harness({
          maxJobs: 2,
          script: {
            boot: () =>
              Deferred.await(gate).pipe(
                Effect.andThen(
                  Effect.fail(Errors.QemuStartError.make({ message: "qemu: exited 1" })),
                ),
              ),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const booting = yield* Effect.forkChild(reservedStart(startBody()), {
              startImmediately: true,
            });
            // The start consumed the reservation, so a second reserve for the agent is admitted
            // and takes the other slot.
            yield* sessions.reserve(AGENT);
            expect(yield* sessions.jobs).toBe(2);
            yield* Deferred.succeed(gate, undefined);
            expect((yield* Effect.flip(Fiber.join(booting)))._tag).toBe("StartFailed");
            // One slot held: the reservation that landed mid-start, not a second one for the
            // same agent.
            expect(yield* sessions.jobs).toBe(1);
            yield* sessions.relinquish(AGENT);
            expect(yield* sessions.jobs).toBe(0);
            yield* sessions.reserve(OTHER_AGENT);
            yield* sessions.reserve("OLI-63");
            expect((yield* Effect.flip(sessions.reserve("OLI-64")))._tag).toBe("AtCapacity");
          }),
        );
      }),
  );

  it.effect(
    "a retry after a boot failure fails on the spent registration, and the kept reservation can still be relinquished (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness({
          maxJobs: 1,
          script: {
            boot: () => Effect.fail(Errors.QemuStartError.make({ message: "qemu: exited 1" })),
          },
        });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const booted = yield* Effect.flip(reservedStart(startBody()));
            expect(booted).toMatchObject({
              _tag: "StartFailed",
              message: "qemu: exited 1",
              agentId: AGENT,
            });
            // The boot spent the agent's one registration: the retry is refused by that key and
            // hands the reservation back once more.
            const retried = yield* Effect.flip(sessions.start(startBody(), "none", false));
            expect(retried).toMatchObject({
              _tag: "StartFailed",
              message: "duplicate key value violates unique constraint",
              agentId: AGENT,
            });
            expect(h.sessions.sessions.map((row) => row.status)).toEqual(["errored", "errored"]);
            expect(yield* sessions.jobs).toBe(1);
            expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
            yield* sessions.relinquish(AGENT);
            expect(yield* sessions.jobs).toBe(0);
            yield* sessions.reserve(OTHER_AGENT);
            expect(yield* qemus(sessions)).toBe(0);
          }),
        );
      }),
  );
});

// ---------------------------------------------------------------------------
// reservation expiry
// ---------------------------------------------------------------------------

// A reservation is a promise that a start follows soon; one nobody starts (the client that took
// it died, or its dispatcher did) is given back after ten minutes, in memory only: no row records
// a reservation, so a restart starts clean.
describe("reservation expiry", () => {
  it.effect(
    "a reservation unused for ten minutes expires: the slot is free, jobs drops, a late start is refused, one warning line",
    () =>
      Effect.gen(function* () {
        const h = harness({ maxJobs: 1 });
        yield* h.run(
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.reserve(AGENT);
            expect(yield* sessions.jobs).toBe(1);
            yield* TestClock.adjust("10 minutes");
            expect(yield* sessions.jobs).toBe(0);
            expect(yield* Effect.flip(sessions.start(startBody(), "none", false))).toMatchObject({
              _tag: "BadRequest",
              message: "no reservation",
              agentId: AGENT,
            });
            yield* sessions.reserve(OTHER_AGENT);
            expect(yield* qemus(sessions)).toBe(0);
            // Nothing durable: no row, no registration, no span.
            expect(h.sessions.sessions).toEqual([]);
            expect(h.sessions.agentRuns).toEqual([]);
            expect(spanNamed(h, AGENT)).toBeUndefined();
            expect(h.log.lines).toEqual([
              {
                level: "warning",
                text: "reservation expired; unused for 10 minutes",
                location: "server",
                agentId: AGENT,
                skipSentry: false,
                cause: undefined,
              },
            ]);
          }),
        );
      }),
  );

  it.effect("a reservation consumed by a start in time never expires", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          yield* TestClock.adjust("5 minutes");
          const id = yield* sessions.start(startBody(), "none", false);
          // Eleven minutes after the reserve, six into the session: the slot is the session's.
          yield* TestClock.adjust("6 minutes");
          expect(yield* sessions.jobs).toBe(1);
          expect(yield* qemus(sessions)).toBe(1);
          expect(h.sessions.sessions.map((row) => [row.id, row.status])).toEqual([[id, "running"]]);
          expect((yield* Effect.flip(sessions.reserve(OTHER_AGENT)))._tag).toBe("AtCapacity");
        }),
      );
      expect(line(h, "reservation expired")).toBeUndefined();
    }),
  );

  it.effect("an expired reservation cannot be relinquished, and its agent may reserve again", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 1 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          yield* TestClock.adjust("10 minutes");
          expect(yield* Effect.flip(sessions.relinquish(AGENT))).toMatchObject({
            _tag: "BadRequest",
            message: "no reservation",
            agentId: AGENT,
          });
          yield* sessions.reserve(AGENT);
          expect(yield* sessions.jobs).toBe(1);
          expect(texts(h)).toEqual(["reservation expired; unused for 10 minutes"]);
        }),
      );
    }),
  );

  it.effect("a younger reservation stays when an older one expires", () =>
    Effect.gen(function* () {
      const h = harness({ maxJobs: 2 });
      yield* h.run(
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.reserve(AGENT);
          yield* TestClock.adjust("5 minutes");
          yield* sessions.reserve(OTHER_AGENT);
          yield* TestClock.adjust("5 minutes");
          expect(yield* sessions.jobs).toBe(1);
          expect(h.log.lines.map((entry) => entry.agentId)).toEqual([AGENT]);
          // The younger one still starts.
          const id = yield* sessions.start(startBody(ISO, OTHER_AGENT), "none", false);
          expect(h.sessions.sessions.map((row) => row.id)).toEqual([id]);
          expect(yield* sessions.jobs).toBe(1);
        }),
      );
    }),
  );
});
