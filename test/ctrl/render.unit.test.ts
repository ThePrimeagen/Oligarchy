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

// The rows as the store lists a history: by name, then oldest first; the version is the row's
// place among its name's rows, so a gap in the ids is not a gap in the versions.
const installRevised = { ...install, id: 7, instruction: "Complete the installer, then log in" };

describe("renderTestDefinitionHistory happy path", () => {
  it("prints one line per wording, name then v<n>, numbering each name from 1", () => {
    expect(Render.renderTestDefinitionHistory([install, installRevised, terminal], false)).toEqual([
      "Install Omarchy v1",
      "Install Omarchy v2",
      "Open a terminal v1",
    ]);
  });

  it("prints every row with its version as one JSON line", () => {
    const lines = Render.renderTestDefinitionHistory([install, installRevised, terminal], true);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual([
      { ...install, createdAt: install.createdAt.toISOString(), version: 1 },
      { ...installRevised, createdAt: installRevised.createdAt.toISOString(), version: 2 },
      { ...terminal, createdAt: terminal.createdAt.toISOString(), version: 1 },
    ]);
  });
});

describe("renderTestDefinitionHistory unhappy path", () => {
  it("prints nothing for no rows and [] as JSON", () => {
    expect(Render.renderTestDefinitionHistory([], false)).toEqual([]);
    expect(Render.renderTestDefinitionHistory([], true)).toEqual(["[]"]);
  });
});

const JOB_RESET = "\x1b[0m";

const job = (
  status: Render.AutomationJobRow["status"],
  action: Render.AutomationJobRow["action"],
  secondsAgo: number,
  ticket: string | null,
  test: string,
): Render.AutomationJobRow => {
  const stamp = ago(secondsAgo);
  return {
    ticket,
    test,
    action,
    status,
    createdAt: stamp,
    startedAt: status === "pending" ? null : stamp,
    finishedAt: status === "pending" || status === "running" ? null : stamp,
  };
};

describe("renderAutomationJobs happy path", () => {
  it("prints running, then pending, then completed, each under its header", () => {
    const lines = Render.renderAutomationJobs(
      {
        running: [job("running", "drive", 5, "OLI-42", "lock-screen")],
        pending: [job("pending", "diagnose", 90, "OLI-43", "lock-screen")],
        completed: [job("succeeded", "drive", 90 * 60, "OLI-41", "Open a terminal")],
      },
      NOW,
    );
    expect(lines).toEqual([
      "running",
      `\x1b[33mrunning  ${JOB_RESET}  drive      5s ago       OLI-42  lock-screen`,
      "pending",
      `\x1b[90mpending  ${JOB_RESET}  diagnose  1m ago       OLI-43  lock-screen`,
      "completed",
      `\x1b[32msucceeded${JOB_RESET}  drive      1h ago       OLI-41  Open a terminal`,
    ]);
  });

  it("colors every job status: gray pending, yellow running, green succeeded, red failed, bright red aborted, magenta timed_out", () => {
    const statuses = ["pending", "running", "succeeded", "failed", "aborted", "timed_out"] as const;
    const lines = Render.renderAutomationJobs(
      {
        running: [job("running", "drive", 1, "OLI-1", "t")],
        pending: [job("pending", "drive", 1, "OLI-2", "t")],
        completed: statuses
          .filter((status) => status !== "pending" && status !== "running")
          .map((status, index) => job(status, "drive", 1, `OLI-${String(index + 3)}`, "t")),
      },
      NOW,
    );
    const colored = lines.filter((line) => line.includes(JOB_RESET));
    expect(colored.map((line) => line.slice(0, line.indexOf(JOB_RESET)))).toEqual([
      "\x1b[33mrunning  ",
      "\x1b[90mpending  ",
      "\x1b[32msucceeded",
      "\x1b[31mfailed   ",
      "\x1b[91maborted  ",
      "\x1b[35mtimed_out",
    ]);
    expect(Object.keys(Render.JOB_STATUS_COLOR).sort()).toEqual([...statuses].sort());
  });

  it("ages a running job from startedAt, a pending job from createdAt, and a completed job from finishedAt", () => {
    const lines = Render.renderAutomationJobs(
      {
        running: [
          {
            ticket: "OLI-10",
            test: "lock-screen",
            action: "drive",
            status: "running",
            createdAt: ago(300),
            startedAt: ago(5),
            finishedAt: null,
          },
        ],
        pending: [
          {
            ticket: "OLI-11",
            test: "lock-screen",
            action: "diagnose",
            status: "pending",
            createdAt: ago(90),
            startedAt: null,
            finishedAt: null,
          },
        ],
        completed: [
          {
            ticket: "OLI-12",
            test: "lock-screen",
            action: "drive",
            status: "failed",
            createdAt: ago(3_600),
            startedAt: ago(3_000),
            finishedAt: ago(60),
          },
        ],
      },
      NOW,
    );
    expect(lines).toEqual([
      "running",
      `\x1b[33mrunning  ${JOB_RESET}  drive      5s ago       OLI-10  lock-screen`,
      "pending",
      `\x1b[90mpending  ${JOB_RESET}  diagnose  1m ago       OLI-11  lock-screen`,
      "completed",
      `\x1b[31mfailed   ${JOB_RESET}  drive      1m ago       OLI-12  lock-screen`,
    ]);
  });

  it("prints — when a job has no ticket", () => {
    const lines = Render.renderAutomationJobs(
      {
        running: [],
        pending: [job("pending", "drive", 5, null, "lock-screen")],
        completed: [],
      },
      NOW,
    );
    expect(lines).toEqual([
      "running",
      "pending",
      `\x1b[90mpending  ${JOB_RESET}  drive      5s ago       —  lock-screen`,
      "completed",
    ]);
  });
});

describe("renderAutomationJobs unhappy path", () => {
  it("prints the three headers and no job lines when every list is empty", () => {
    expect(Render.renderAutomationJobs({ running: [], pending: [], completed: [] }, NOW)).toEqual([
      "running",
      "pending",
      "completed",
    ]);
  });

  it("renders a stamp ahead of this clock as 0s ago, never a negative age", () => {
    const lines = Render.renderAutomationJobs(
      {
        running: [job("running", "drive", -45, "OLI-9", "lock-screen")],
        pending: [],
        completed: [],
      },
      NOW,
    );
    expect(lines).toEqual([
      "running",
      `\x1b[33mrunning  ${JOB_RESET}  drive      0s ago       OLI-9  lock-screen`,
      "pending",
      "completed",
    ]);
  });
});
