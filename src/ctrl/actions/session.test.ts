import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { printSessions } from "./session.ts";

afterEach(() => mock.restoreAll());

const NOW = Date.parse("2026-09-04T12:00:00Z");
const RESET = "\x1b[0m";

function ago(seconds: number): Date {
  return new Date(NOW - seconds * 1000);
}

function printed(rows: Parameters<typeof printSessions>[0]): string[] {
  mock.method(Date, "now", () => NOW);
  const log = mock.method(console, "log", () => undefined);
  printSessions(rows);
  return log.mock.calls.map((call) => call.arguments.join(" "));
}

describe("printSessions happy path", () => {
  it("prints one line per session in the order given: colored status, age, then the plain id", () => {
    const lines = printed([
      { id: "d889e62f-212a-4ee4-a299-7e21b02b5308", status: "running", startedAt: ago(5) },
      { id: "ff88a0b1-0851-47a7-91d3-acbfb20b8673", status: "succeeded", startedAt: ago(90) },
    ]);
    assert.deepEqual(lines, [
      `\x1b[33mrunning    ${RESET}  5s ago       d889e62f-212a-4ee4-a299-7e21b02b5308`,
      `\x1b[32msucceeded  ${RESET}  1m ago       ff88a0b1-0851-47a7-91d3-acbfb20b8673`,
    ]);
  });

  it("colors every status: green succeeded, red failed, yellow running, gray downloading, bright red aborted, magenta timed_out", () => {
    const lines = printed([
      { id: "00000000-0000-4000-8000-000000000001", status: "succeeded", startedAt: ago(1) },
      { id: "00000000-0000-4000-8000-000000000002", status: "failed", startedAt: ago(1) },
      { id: "00000000-0000-4000-8000-000000000003", status: "running", startedAt: ago(1) },
      { id: "00000000-0000-4000-8000-000000000004", status: "downloading", startedAt: ago(1) },
      { id: "00000000-0000-4000-8000-000000000005", status: "aborted", startedAt: ago(1) },
      { id: "00000000-0000-4000-8000-000000000006", status: "timed_out", startedAt: ago(1) },
    ]);
    assert.deepEqual(
      lines.map((line) => line.slice(0, line.indexOf(RESET))),
      [
        "\x1b[32msucceeded  ",
        "\x1b[31mfailed     ",
        "\x1b[33mrunning    ",
        "\x1b[90mdownloading",
        "\x1b[91maborted    ",
        "\x1b[35mtimed_out  ",
      ],
    );
    for (const line of lines) {
      assert.match(line.slice(line.indexOf(RESET) + RESET.length), /^  1s ago       00000000-0000-4000-8000-00000000000\d$/);
    }
  });

  it("renders the age as seconds, minutes, hours with minutes, whole hours, and days with hours", () => {
    const lines = printed([
      { id: "00000000-0000-4000-8000-000000000001", status: "running", startedAt: ago(0) },
      { id: "00000000-0000-4000-8000-000000000002", status: "running", startedAt: ago(59) },
      { id: "00000000-0000-4000-8000-000000000003", status: "running", startedAt: ago(60) },
      { id: "00000000-0000-4000-8000-000000000004", status: "running", startedAt: ago(59 * 60 + 59) },
      { id: "00000000-0000-4000-8000-000000000005", status: "running", startedAt: ago(60 * 60) },
      { id: "00000000-0000-4000-8000-000000000006", status: "running", startedAt: ago(90 * 60) },
      { id: "00000000-0000-4000-8000-000000000007", status: "running", startedAt: ago(23 * 60 * 60 + 59 * 60) },
      { id: "00000000-0000-4000-8000-000000000008", status: "running", startedAt: ago(24 * 60 * 60) },
      { id: "00000000-0000-4000-8000-000000000009", status: "running", startedAt: ago(3 * 24 * 60 * 60 + 5 * 60 * 60 + 40 * 60) },
    ]);
    assert.deepEqual(
      lines.map((line) => line.slice(line.indexOf(RESET) + RESET.length + 2, line.lastIndexOf("  "))),
      ["0s ago     ", "59s ago    ", "1m ago     ", "59m ago    ", "1h ago     ", "1h30m ago  ", "23h59m ago ", "1d ago     ", "3d5h ago   "],
    );
  });
});

describe("printSessions unhappy path", () => {
  it("prints nothing for no sessions", () => {
    assert.deepEqual(printed([]), []);
  });

  it("renders a session started ahead of this clock as 0s ago, never a negative age", () => {
    const lines = printed([{ id: "00000000-0000-4000-8000-000000000001", status: "downloading", startedAt: ago(-45) }]);
    assert.deepEqual(lines, [`\x1b[90mdownloading${RESET}  0s ago       00000000-0000-4000-8000-000000000001`]);
  });
});
