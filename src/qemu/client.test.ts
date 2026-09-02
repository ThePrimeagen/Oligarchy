import assert from "node:assert/strict";
import type { Socket } from "node:net";
import { describe, it } from "node:test";
import { createQemu, sendKey } from "./client.ts";

const keys = [{ type: "qcode", data: "a" }] satisfies QemuKeyValue[];

describe("sendKey recorder happy path", () => {
  it("records the command and completed response", async () => {
    const qemu = createQemu();
    let command: QemuCommand | undefined;
    let outcome: QemuExchangeOutcome | undefined;
    qemu.socket = {
      write(data: string) {
        command = JSON.parse(data) as QemuCommand;
        queueMicrotask(() => {
          qemu.pending.get(command!.id)?.resolve({ return: {}, id: command!.id });
        });
        return true;
      },
    } as Socket;

    await sendKey(qemu, keys, async (sent) => {
      command = sent;
      return async (result) => {
        outcome = result;
      };
    });

    assert.equal(command?.execute, "send-key");
    assert.deepEqual(outcome, {
      state: "completed",
      response: { return: {}, id: command?.id },
    });
  });
});

describe("sendKey recorder unhappy path", () => {
  it("fails the action without writing when QEMU stops while the recorder opens", async () => {
    const qemu = createQemu();
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wrote = false;
    let outcome: QemuExchangeOutcome | undefined;
    qemu.socket = {
      write() {
        wrote = true;
        throw new Error("wrote to a stale socket");
      },
    } as unknown as Socket;

    const sending = sendKey(qemu, keys, async () => {
      await opened;
      return async (result) => {
        outcome = result;
      };
    });
    qemu.socket = undefined;
    release();

    await assert.rejects(sending, { message: "qemu: closed" });
    assert.equal(wrote, false);
    assert.deepEqual(outcome, {
      state: "failed",
      response: "qemu: closed",
    });
  });
});
