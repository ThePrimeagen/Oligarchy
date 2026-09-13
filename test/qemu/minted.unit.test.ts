import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
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
          Layer.succeed(Iso.Host)({ homeDir: "/home/u", pid: PID }),
        ),
      ),
    );
    const minted = yield* Effect.provide(Minted.Minted, layer);
    return { spawner, fs, log, minted };
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

describe("save happy path", () => {
  it.effect(
    "copies the firmware, then converts the disk, each as a partial renamed into place",
    () =>
      Effect.gen(function* () {
        const { spawner, fs, minted } = yield* fixture();
        yield* minted.save(URL_ISO, FROM, WHO);
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
  it.effect("a failing convert removes its partial, leaves the firmware in place and fails", () =>
    Effect.gen(function* () {
      const { spawner, fs, minted } = yield* fixture({ qemuImg: { exitCode: 1 } });
      const error = yield* Effect.flip(minted.save(URL_ISO, FROM, WHO));
      expect(error).toMatchObject({
        _tag: "SaveFailed",
        message: "qemu-img convert exited 1",
        sessionId: WHO.sessionId,
        agentId: WHO.agentId,
      });
      expect(spawner.spawned).toHaveLength(1);
      expect(fs.calls.slice(2)).toEqual([
        { method: "remove", args: [`${CACHED}.qcow2.partial-${String(PID)}`, { force: true }] },
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
    "a rename the file system refuses fails with Node's message and removes the partial",
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
      }),
  );
});
