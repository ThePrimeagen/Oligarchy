import { describe, expect, it } from "vitest";
import * as Render from "../../src/ctrl/render.ts";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const RESET = "\x1b[0m";

const ago = (seconds: number): Date => new Date(NOW - seconds * 1000);

const ids = {
  running: "d889e62f-212a-4ee4-a299-7e21b02b5308",
  downloading: "ff88a0b1-0851-47a7-91d3-acbfb20b8673",
};

describe("renderSessions happy path", () => {
  it("prints JSON session objects for machine consumers", () => {
    const lines = Render.renderSessions(
      [
        { id: ids.running, status: "running", startedAt: ago(5) },
        { id: ids.downloading, status: "downloading", startedAt: ago(90) },
      ],
      true,
      NOW,
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual([
      { id: ids.running, status: "running", startedAt: "2026-09-04T11:59:55.000Z" },
      { id: ids.downloading, status: "downloading", startedAt: "2026-09-04T11:58:30.000Z" },
    ]);
  });

  it("prints one line per session in the order given: colored status, age, then the plain id", () => {
    const lines = Render.renderSessions(
      [
        { id: ids.running, status: "running", startedAt: ago(5) },
        { id: ids.downloading, status: "succeeded", startedAt: ago(90) },
      ],
      false,
      NOW,
    );
    expect(lines).toEqual([
      `\x1b[33mrunning    ${RESET}  5s ago       ${ids.running}`,
      `\x1b[32msucceeded  ${RESET}  1m ago       ${ids.downloading}`,
    ]);
  });

  it("colors every status: green succeeded, red failed, yellow running, gray downloading, bright red aborted, magenta timed_out", () => {
    const statuses = [
      "succeeded",
      "failed",
      "running",
      "downloading",
      "aborted",
      "timed_out",
    ] as const;
    const lines = Render.renderSessions(
      statuses.map((status, index) => ({
        id: `00000000-0000-4000-8000-00000000000${String(index + 1)}`,
        status,
        startedAt: ago(1),
      })),
      false,
      NOW,
    );
    expect(lines.map((line) => line.slice(0, line.indexOf(RESET)))).toEqual([
      "\x1b[32msucceeded  ",
      "\x1b[31mfailed     ",
      "\x1b[33mrunning    ",
      "\x1b[90mdownloading",
      "\x1b[91maborted    ",
      "\x1b[35mtimed_out  ",
    ]);
    for (const line of lines) {
      expect(line.slice(line.indexOf(RESET) + RESET.length)).toMatch(
        /^ {2}1s ago {7}00000000-0000-4000-8000-00000000000\d$/,
      );
    }
    expect(Object.keys(Render.STATUS_COLOR).sort()).toEqual([...statuses].sort());
  });

  it("renders the age as seconds, minutes, hours with minutes, whole hours, and days with hours", () => {
    const seconds = [
      0,
      59,
      60,
      59 * 60 + 59,
      60 * 60,
      90 * 60,
      23 * 60 * 60 + 59 * 60,
      24 * 60 * 60,
      3 * 24 * 60 * 60 + 5 * 60 * 60 + 40 * 60,
    ];
    expect(seconds.map((s) => Render.age(NOW, ago(s)))).toEqual([
      "0s ago",
      "59s ago",
      "1m ago",
      "59m ago",
      "1h ago",
      "1h30m ago",
      "23h59m ago",
      "1d ago",
      "3d5h ago",
    ]);
    const lines = Render.renderSessions(
      seconds.map((s, index) => ({
        id: `00000000-0000-4000-8000-00000000000${String(index + 1)}`,
        status: "running",
        startedAt: ago(s),
      })),
      false,
      NOW,
    );
    expect(
      lines.map((line) =>
        line.slice(line.indexOf(RESET) + RESET.length + 2, line.lastIndexOf("  ")),
      ),
    ).toEqual([
      "0s ago     ",
      "59s ago    ",
      "1m ago     ",
      "59m ago    ",
      "1h ago     ",
      "1h30m ago  ",
      "23h59m ago ",
      "1d ago     ",
      "3d5h ago   ",
    ]);
  });
});

describe("renderSessions unhappy path", () => {
  it("prints an empty JSON array when there are no sessions", () => {
    expect(Render.renderSessions([], true, NOW)).toEqual(["[]"]);
  });

  it("prints nothing for no sessions", () => {
    expect(Render.renderSessions([], false, NOW)).toEqual([]);
  });

  it("renders a session started ahead of this clock as 0s ago, never a negative age", () => {
    expect(Render.age(NOW, ago(-45))).toBe("0s ago");
    expect(
      Render.renderSessions(
        [
          {
            id: "00000000-0000-4000-8000-000000000001",
            status: "downloading",
            startedAt: ago(-45),
          },
        ],
        false,
        NOW,
      ),
    ).toEqual([`\x1b[90mdownloading${RESET}  0s ago       00000000-0000-4000-8000-000000000001`]);
  });
});

const install = {
  id: 1,
  name: "Install Omarchy",
  description: "Install the operating system",
  instruction: "Complete the installer",
  proof: "The desktop is visible",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const terminal = {
  id: 2,
  name: "Open a terminal",
  description: "Verify the terminal starts",
  instruction: "Launch the terminal",
  proof: "A terminal window is visible",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

describe("renderTestDefinitions happy path", () => {
  it("prints one name per line", () => {
    expect(Render.renderTestDefinitions([install, terminal], false)).toEqual([
      "Install Omarchy",
      "Open a terminal",
    ]);
  });

  it("prints every field of every definition as one JSON line", () => {
    const lines = Render.renderTestDefinitions([install, terminal], true);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual([
      { ...install, createdAt: install.createdAt.toISOString() },
      { ...terminal, createdAt: terminal.createdAt.toISOString() },
    ]);
  });
});

describe("renderTestDefinitions unhappy path", () => {
  it("prints nothing for no definitions and [] as JSON", () => {
    expect(Render.renderTestDefinitions([], false)).toEqual([]);
    expect(Render.renderTestDefinitions([], true)).toEqual(["[]"]);
  });
});
