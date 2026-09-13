import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodePath } from "@effect/platform-node";
import { Effect, Fiber, Layer, Option } from "effect";
import * as Args from "../../src/qemu/args.ts";
import * as Iso from "../../src/qemu/iso.ts";
import * as Minted from "../../src/qemu/minted.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeQemu from "../support/fake-qemu.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as FakeLog from "../support/log.ts";

const URL_ISO = "https://iso.example.com/omarchy/omarchy-3.0.iso";
const CACHED = "/home/u/.oligarchy/isos/https___iso.example.com_omarchy_omarchy-3.0.iso";
const LOCAL_ISO = "/isos/omarchy.iso";
const PID = 4242;
const WHO = { sessionId: "1baaad43-674b-4bdb-88d7-3f18fce50aba", agentId: "OLI-61" };
const SESSION_DIR = "/tmp/oligarchy-1baaad43-674b-4bdb-88d7-3f18fce50aba";
const FROM = { disk: `${SESSION_DIR}/disk.qcow2`, vars: `${SESSION_DIR}/OVMF_VARS.fd` };

type Fixture = {
  // What exists on disk before the save; the session's two files by default.
  readonly entries?: FakeFs.Entries;
  readonly qemuImg?: FakeSpawner.Scripted;
  // Rename targets that fail with EACCES.
  readonly renameFails?: ReadonlyArray<string>;
};

const fixture = (options: Fixture = {}) =>
  Effect.gen(function* () {
    const spawner = FakeSpawner.fakeSpawner(
      FakeSpawner.byCommand({ [Args.QEMU_IMG]: options.qemuImg ?? { exitCode: 0 } }),
    );
    const fs = FakeFs.recordingFs(options.entries ?? { [FROM.disk]: "File", [FROM.vars]: "File" }, {
      overrides: {
        rename: (from, to) =>
          Effect.suspend(() => {
            fs.calls.push({ method: "rename", args: [from, to] });
            return options.renameFails?.includes(to) === true
              ? Effect.fail(FakeFs.permissionDenied("rename", to))
              : Effect.void;
          }),
      },
    });
    const iso = FakeQemu.fakeIso(undefined, (name) => (name === URL_ISO ? CACHED : name));
    const log = FakeLog.fakeLog();
    const layer = Minted.Minted.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          fs.layer,
          NodePath.layer,
          spawner.layer,
          iso.layer,
          log.layer,
          Layer.succeed(Iso.Host)({ dataDir: "/home/u/.oligarchy", pid: PID }),
        ),
      ),
    );
    const minted = yield* Effect.provide(Minted.Minted, layer);
    return { spawner, fs, log, minted };
  });

// Lets forked saves run through their file calls without advancing the clock.
const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

describe("filesFor", () => {
  it.effect("names the two files beside the iso's own path", () => {
    expect(Minted.filesFor(CACHED)).toEqual({
      disk: `${CACHED}.qcow2`,
      vars: `${CACHED}.OVMF_VARS.fd`,
    });
    expect(Minted.filesFor(LOCAL_ISO)).toEqual({
      disk: "/isos/omarchy.iso.qcow2",
      vars: "/isos/omarchy.iso.OVMF_VARS.fd",
    });
    return Effect.void;
  });
});

describe("find", () => {
  it.effect("answers the two files beside the iso's path when both exist", () =>
    Effect.gen(function* () {
      const { fs, minted } = yield* fixture({
        entries: { [`${CACHED}.qcow2`]: "File", [`${CACHED}.OVMF_VARS.fd`]: "File" },
      });
      expect(yield* minted.find(URL_ISO)).toEqual(
        Option.some({ disk: `${CACHED}.qcow2`, vars: `${CACHED}.OVMF_VARS.fd` }),
      );
      expect(FakeFs.methods(fs)).toEqual(["stat", "stat"]);
    }),
  );

  it.effect("answers none when either file is missing, or both", () =>
    Effect.gen(function* () {
      const diskOnly = yield* fixture({ entries: { [`${CACHED}.qcow2`]: "File" } });
      expect(yield* diskOnly.minted.find(URL_ISO)).toEqual(Option.none());
      const varsOnly = yield* fixture({ entries: { [`${CACHED}.OVMF_VARS.fd`]: "File" } });
      expect(yield* varsOnly.minted.find(URL_ISO)).toEqual(Option.none());
      const neither = yield* fixture({ entries: {} });
      expect(yield* neither.minted.find(URL_ISO)).toEqual(Option.none());
    }),
  );

  it.effect("looks beside a local iso's own path, whether or not the iso itself is there", () =>
    Effect.gen(function* () {
      const { minted } = yield* fixture({
        entries: { "/isos/omarchy.iso.qcow2": "File", "/isos/omarchy.iso.OVMF_VARS.fd": "File" },
      });
      expect(yield* minted.find(LOCAL_ISO)).toEqual(
        Option.some({ disk: "/isos/omarchy.iso.qcow2", vars: "/isos/omarchy.iso.OVMF_VARS.fd" }),
      );
    }),
  );
});

describe("save happy path", () => {
  it.effect(
    "stages the firmware copy and the converted disk as partials, then publishes both, firmware first",
    () =>
      Effect.gen(function* () {
        // The convert runs until told: while it runs, only the copy has happened, no rename.
        const { spawner, fs, minted } = yield* fixture({ qemuImg: {} });
        const saving = yield* Effect.forkChild(minted.save(URL_ISO, FROM, WHO));
        yield* settle;
        expect(fs.calls.map((call) => call.method)).toEqual(["copyFile"]);
        expect(spawner.spawned).toHaveLength(1);
        yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
        yield* Fiber.join(saving);
        expect(fs.calls).toEqual([
          {
            method: "copyFile",
            args: [FROM.vars, `${CACHED}.OVMF_VARS.fd.partial-${String(PID)}`],
          },
          {
            method: "rename",
            args: [`${CACHED}.OVMF_VARS.fd.partial-${String(PID)}`, `${CACHED}.OVMF_VARS.fd`],
          },
          {
            method: "rename",
            args: [`${CACHED}.qcow2.partial-${String(PID)}`, `${CACHED}.qcow2`],
          },
        ]);
        expect(spawner.spawned.map((spawned) => spawned.args)).toEqual([
          ["convert", "-O", "qcow2", FROM.disk, `${CACHED}.qcow2.partial-${String(PID)}`],
        ]);
      }),
  );

  it.effect("writes beside a local iso's own path", () =>
    Effect.gen(function* () {
      const { fs, minted } = yield* fixture();
      yield* minted.save(LOCAL_ISO, FROM, WHO);
      expect(fs.calls.map((call) => call.args.at(-1))).toEqual([
        `/isos/omarchy.iso.OVMF_VARS.fd.partial-${String(PID)}`,
        "/isos/omarchy.iso.OVMF_VARS.fd",
        "/isos/omarchy.iso.qcow2",
      ]);
    }),
  );

  it.effect("two saves in one process run one after the other, never sharing a partial", () =>
    Effect.gen(function* () {
      // Runs until told: the convert of the first save holds the second behind it.
      const { spawner, minted } = yield* fixture({ qemuImg: {} });
      const first = yield* Effect.forkChild(minted.save(URL_ISO, FROM, WHO));
      yield* settle;
      const second = yield* Effect.forkChild(minted.save(URL_ISO, FROM, WHO));
      yield* settle;
      expect(spawner.spawned).toHaveLength(1);
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(first);
      yield* settle;
      expect(spawner.spawned).toHaveLength(2);
      yield* spawner.spawned[1]?.exit(0) ?? Effect.void;
      yield* Fiber.join(second);
    }),
  );

  it.effect("overwrites a minted disk already there without looking first", () =>
    Effect.gen(function* () {
      const { fs, minted } = yield* fixture({
        entries: {
          [FROM.disk]: "File",
          [FROM.vars]: "File",
          [`${CACHED}.qcow2`]: "File",
          [`${CACHED}.OVMF_VARS.fd`]: "File",
        },
      });
      yield* minted.save(URL_ISO, FROM, WHO);
      expect(FakeFs.methods(fs)).toEqual(["copyFile", "rename", "rename"]);
    }),
  );
});

describe("save unhappy path", () => {
  it.effect(
    "a failing convert removes both partials and renames nothing: the pair in place is untouched",
    () =>
      Effect.gen(function* () {
        const { spawner, fs, minted } = yield* fixture({
          qemuImg: { exitCode: 1 },
          entries: {
            [FROM.disk]: "File",
            [FROM.vars]: "File",
            [`${CACHED}.qcow2`]: "File",
            [`${CACHED}.OVMF_VARS.fd`]: "File",
          },
        });
        const error = yield* Effect.flip(minted.save(URL_ISO, FROM, WHO));
        expect(error).toMatchObject({
          _tag: "SaveFailed",
          message: "qemu-img convert exited 1",
          sessionId: WHO.sessionId,
          agentId: WHO.agentId,
        });
        expect(spawner.spawned).toHaveLength(1);
        expect(fs.calls.map((call) => call.method)).toEqual(["copyFile", "remove", "remove"]);
        expect(fs.calls.slice(1).map((call) => call.args[0])).toEqual([
          `${CACHED}.qcow2.partial-${String(PID)}`,
          `${CACHED}.OVMF_VARS.fd.partial-${String(PID)}`,
        ]);
      }),
  );

  it.effect("a firmware copy that fails stops before the convert and removes its partial", () =>
    Effect.gen(function* () {
      const { spawner, fs, minted } = yield* fixture({ entries: { [FROM.disk]: "File" } });
      const error = yield* Effect.flip(minted.save(URL_ISO, FROM, WHO));
      expect(error).toMatchObject({
        _tag: "SaveFailed",
        message: `ENOENT: no such file or directory, copyfile '${FROM.vars}'`,
        sessionId: WHO.sessionId,
        agentId: WHO.agentId,
      });
      expect(spawner.spawned).toEqual([]);
      expect(fs.calls.map((call) => call.method)).toEqual(["copyFile", "remove"]);
      expect(fs.calls[1]?.args).toEqual([
        `${CACHED}.OVMF_VARS.fd.partial-${String(PID)}`,
        { force: true },
      ]);
    }),
  );

  it.effect(
    "a rename the file system refuses fails with Node's message and removes the partials",
    () =>
      Effect.gen(function* () {
        const { fs, minted } = yield* fixture({ renameFails: [`${CACHED}.qcow2`] });
        const error = yield* Effect.flip(minted.save(URL_ISO, FROM, WHO));
        expect(error).toMatchObject({
          _tag: "SaveFailed",
          message: `EACCES: permission denied, rename '${CACHED}.qcow2'`,
        });
        expect(fs.calls.at(-1)).toEqual({
          method: "remove",
          args: [`${CACHED}.qcow2.partial-${String(PID)}`, { force: true }],
        });
        // The firmware was published first: a refused disk rename leaves it in place.
        const firmware = yield* fixture({ renameFails: [`${CACHED}.OVMF_VARS.fd`] });
        yield* Effect.flip(firmware.minted.save(URL_ISO, FROM, WHO));
        expect(firmware.fs.calls.slice(-2).map((call) => call.args[0])).toEqual([
          `${CACHED}.OVMF_VARS.fd.partial-${String(PID)}`,
          `${CACHED}.qcow2.partial-${String(PID)}`,
        ]);
      }),
  );
});
