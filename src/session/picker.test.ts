/* oxlint-disable no-control-regex -- the escape sequences under test */
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { emitKeypressEvents } from "node:readline";
import { pickFollowSession } from "./picker.ts";

const RUNNING_ID = "d889e62f-212a-4ee4-a299-7e21b02b5308";
const DOWNLOADING_ID = "ff88a0b1-0851-47a7-91d3-acbfb20b8673";

function terminal(): {
  inputStream: PassThrough;
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  readOutput: () => string;
} {
  const inputStream = new PassThrough();
  const outputStream = new PassThrough();
  let written = "";
  outputStream.setEncoding("utf8");
  outputStream.on("data", (data: string) => {
    written += data;
  });
  const input = inputStream as unknown as NodeJS.ReadStream;
  const output = outputStream as unknown as NodeJS.WriteStream;
  Object.assign(output, { columns: 100 });
  emitKeypressEvents(input);
  return { inputStream, input, output, readOutput: () => written };
}

describe("follow session picker happy path", () => {
  it("shows running sessions first, colors statuses, and selects with the keyboard", async () => {
    const term = terminal();
    const selection = pickFollowSession(
      [
        { id: DOWNLOADING_ID, status: "downloading", startedAt: "2026-09-04T11:58:30.000Z" },
        { id: "00000000-0000-4000-8000-000000000001", status: "succeeded", startedAt: "2026-09-04T11:58:00.000Z" },
        { id: RUNNING_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" },
      ],
      term.input,
      term.output,
      16,
    );
    term.inputStream.write("\t");
    term.inputStream.write("\r");

    assert.equal(await selection, DOWNLOADING_ID);
    const output = term.readOutput();
    assert.ok(output.indexOf(RUNNING_ID) < output.indexOf(DOWNLOADING_ID));
    assert.match(output, new RegExp(`\\x1b\\[33mrunning\\s*\\x1b\\[0m\\s+${RUNNING_ID}`));
    assert.match(output, new RegExp(`\\x1b\\[90mpending\\s*\\x1b\\[0m\\s+${DOWNLOADING_ID}`));
    assert.equal(output.includes("00000000-0000-4000-8000-000000000001"), false);
  });
});

describe("follow session picker unhappy path", () => {
  it("reports that there is nothing to follow when no active sessions exist", async () => {
    const term = terminal();
    const selection = await pickFollowSession(
      [{ id: "00000000-0000-4000-8000-000000000001", status: "failed", startedAt: "2026-09-04T11:58:00.000Z" }],
      term.input,
      term.output,
      16,
    );

    assert.equal(selection, undefined);
    assert.match(term.readOutput(), /no running or pending sessions/);
  });

  it("cancels without selecting when escape is pressed", async () => {
    const term = terminal();
    const selection = pickFollowSession(
      [{ id: RUNNING_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" }],
      term.input,
      term.output,
      16,
    );
    term.inputStream.write("\x1b");

    assert.equal(await selection, undefined);
    assert.match(term.readOutput(), /\x1b\[\?25l.*\x1b\[\?25h/s);
  });
});
