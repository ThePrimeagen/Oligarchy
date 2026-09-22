import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import type {
  AutomationJob,
  AutomationQueue,
  ProcessSeries,
  Server,
  SuiteBoard,
  SuitePill,
} from "../../src/dashboard/query.ts";
import { Fleet, Process, Queue, ServersPage } from "../../src/dashboard/servers.tsx";

const QUERIED_AT = new Date("2026-09-09T16:00:00Z");

const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

const alive: Server = {
  url: "http://127.0.0.1:55332",
  name: "garage",
  stats: {
    qemus: 2,
    memory: { totalBytes: 66_900_000_000, usedBytes: 31_500_000_000 },
    cpu: { mean1m: 12.3, mean2m: 11, mean3m: 9.8 },
  },
  generation: 42,
  heartbeatAt: ago(12),
  queriedAt: QUERIED_AT,
};

const silent: Server = {
  url: "https://qemu-b.example.com",
  name: "attic",
  stats: {
    qemus: 3,
    memory: { totalBytes: 16_000_000_000, usedBytes: 4_000_000_000 },
    cpu: { mean1m: 50, mean2m: 40, mean3m: 30 },
  },
  generation: 7,
  heartbeatAt: ago(5 * 60 + 12),
  queriedAt: QUERIED_AT,
};

const neverHeardFrom: Server = {
  url: "https://qemu-c.example.com",
  name: null,
  stats: null,
  generation: 0,
  heartbeatAt: null,
  queriedAt: QUERIED_AT,
};

const running: AutomationJob = {
  ticket: "OLI-61",
  test: "lock-screen",
  action: "diagnose",
  status: "running",
  reason: null,
  createdAt: ago(180),
  startedAt: ago(45),
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

const pending: AutomationJob = {
  ticket: "OLI-62",
  test: "install",
  action: "drive",
  status: "pending",
  reason: null,
  createdAt: ago(7),
  startedAt: null,
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

const failed: AutomationJob = {
  ticket: "OLI-60",
  test: "wifi",
  action: "drive",
  status: "failed",
  reason: "session timed out",
  createdAt: ago(3_900),
  startedAt: ago(3_800),
  finishedAt: ago(600),
  queriedAt: QUERIED_AT,
};

const PASSED_RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const FAILED_RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const RUNNING_RUN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const PENDING_RUN = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";

const suitePill = (
  id: string,
  status: SuitePill["status"],
  startedAt: Date,
  counts: Partial<Pick<SuitePill, "pending" | "running" | "passed" | "failed">> = {},
): SuitePill => ({
  id,
  name: "Omarchy experiment",
  status,
  startedAt,
  pending: 0,
  running: 0,
  passed: 0,
  failed: 0,
  ...counts,
});

const SUITES: SuiteBoard = {
  pending: 1,
  running: 1,
  passed: 4,
  failed: 1,
  aborted: 0,
  queriedAt: QUERIED_AT,
  pills: [
    suitePill(PASSED_RUN, "passed", ago(3_600), { passed: 8 }),
    suitePill(FAILED_RUN, "failed", ago(1_800), { passed: 1, failed: 2 }),
    suitePill(RUNNING_RUN, "running", ago(900), { running: 1, failed: 2 }),
    suitePill(PENDING_RUN, "pending", ago(30), { pending: 3 }),
  ],
};
const SUITES_QUIET: SuiteBoard = {
  pending: 0,
  running: 0,
  passed: 0,
  failed: 0,
  aborted: 0,
  queriedAt: QUERIED_AT,
  pills: [],
};
const QUEUE: AutomationQueue = {
  running: [running],
  pending: [pending],
  completed: [failed],
  runningCount: 1,
  pendingCount: 1,
  suites: SUITES,
};
const EMPTY_QUEUE: AutomationQueue = {
  running: [],
  pending: [],
  completed: [],
  runningCount: 0,
  pendingCount: 0,
  suites: SUITES_QUIET,
};

const processAlive: ProcessSeries = {
  name: "garage",
  type: "qemu",
  jobs: 2,
  memoryBytes: 512_000_000,
  cpuPercent: 37.5,
  reportedAt: ago(12),
  queriedAt: QUERIED_AT,
  samples: [
    { jobs: 1, memoryBytes: 256_000_000, cpuPercent: 10, reportedAt: ago(42) },
    { jobs: 2, memoryBytes: 512_000_000, cpuPercent: 37.5, reportedAt: ago(12) },
  ],
};

const processSilent: ProcessSeries = {
  name: "attic",
  type: "automation-client",
  jobs: 1,
  memoryBytes: 256_000_000,
  cpuPercent: 8,
  reportedAt: ago(5 * 60 + 12),
  queriedAt: QUERIED_AT,
  samples: [{ jobs: 1, memoryBytes: 256_000_000, cpuPercent: 8, reportedAt: ago(5 * 60 + 12) }],
};

const JOB_COLUMNS =
  "<tr><th>ticket</th><th>test</th><th>action</th><th>status</th><th>queued</th><th>started</th><th>finished</th><th>reason</th><th></th></tr>";

const linearLink = (ticket: string): string =>
  `<a class="ticket" href="https://linear.app/issue/${encodeURIComponent(ticket)}">${ticket}</a>`;

// The test name is the one follow link in the tab order. The rest of the row opens the same
// page but stays out of the way of the keyboard.
const followCell = (ticket: string, text: string, primary = false): string =>
  `<td class="follow"><a href="/tickets/${encodeURIComponent(ticket)}"${primary ? "" : ' tabindex="-1" aria-hidden="true"'}>${text}</a></td>`;

const ticketRow = (
  ticket: string,
  cells: readonly [string, string, string, string, string, string, string],
  abort: string,
): string => {
  const cellsHtml = `<tr><td>${linearLink(ticket)}</td>${followCell(ticket, cells[0], true)}${followCell(ticket, cells[1])}${followCell(ticket, cells[2])}${followCell(ticket, cells[3])}${followCell(ticket, cells[4])}${followCell(ticket, cells[5])}${followCell(ticket, cells[6])}<td>`;
  // An abort is the form up through its button. The icon after that button is not the row.
  return abort === "" ? `${cellsHtml}</td></tr>` : `${cellsHtml}${abort}`;
};

// The form names the row: a ticket has one drive and one diagnose, so the action is the rest of
// its key. The button's icon is not part of what the post does.
const abortForm = (ticket: string, action: AutomationJob["action"]): string =>
  `<form method="post" action="/abort" hx-post="/abort" hx-confirm="are you sure?" hx-target="#queue" hx-swap="innerHTML"><input type="hidden" name="ticket" value="${ticket}"/><input type="hidden" name="action" value="${action}"/><button type="submit" class="abort" aria-label="abort">`;

const closeForm = (run: string): string =>
  `<form method="post" action="/suites/close" hx-post="/suites/close" hx-confirm="are you sure?" hx-target="#queue" hx-swap="innerHTML"><input type="hidden" name="run" value="${run}"/><button type="submit">close</button></form>`;

const listItem = (page: string, text: string): string =>
  page.split("<li>").find((item) => item.includes(text)) ?? "";

// The components are functions of their props; the string they render, through the same html
// helper the routes serve them with, is the page. The helper hands back a String object, hence
// the primitive.
const render = async (element: ReturnType<typeof Fleet>): Promise<string> =>
  String(await html`${element}`);

// The jobs under one heading, however the headings are arranged on the page.
const bucket = (page: string, heading: string): string => {
  const start = page.indexOf(`<h3>${heading}</h3>`);
  if (start < 0) {
    return "";
  }
  const after = page.slice(start);
  const table = /^<h3>[^<]*<\/h3><table>[\s\S]*?<\/table>/.exec(after);
  if (table?.[0] !== undefined) {
    return table[0];
  }
  const next = after.indexOf("<h3>", 4);
  return next === -1 ? after : after.slice(0, next);
};

describe("Fleet happy path", () => {
  it("lists a server heard from just now with its machines, memory, the three cpu means, its generation and the age of its heartbeat", async () => {
    const page = await render(Fleet({ servers: [alive] }));
    expect(page).toContain(
      "<tr><th>name</th><th>url</th><th>qemus</th><th>memory</th><th>cpu 1m / 2m / 3m</th><th>generation</th><th>heartbeat</th><th></th></tr>",
    );
    expect(page).toContain(
      "<tr><td>garage</td><td>http://127.0.0.1:55332</td><td>2</td><td>31.5 / 66.9 GB</td><td>12.3% / 11.0% / 9.8%</td><td>42</td><td>12 s ago</td>",
    );
    expect(page).toContain(
      '<form method="post" action="/servers/delete"><input type="hidden" name="url" value="http://127.0.0.1:55332"/><button>delete</button></form>',
    );
  });

  it("says no servers registered for an empty fleet, with no table", async () => {
    const page = await render(Fleet({ servers: [] }));
    expect(page).toBe("<p>no servers registered</p>");
  });

  it("reads the heartbeat's age in the unit an operator would: seconds, then minutes, hours, days", async () => {
    const at = (secondsAgo: number): Server => ({ ...alive, heartbeatAt: ago(secondsAgo) });
    const page = await render(
      Fleet({ servers: [at(0), at(59), at(60), at(3_599), at(3_600), at(90_000)] }),
    );
    expect(page).toContain("<td>0 s ago</td>");
    expect(page).toContain("<td>59 s ago</td>");
    expect(page).toContain("<td>1 min ago</td>");
    expect(page).toContain("<td>59 min ago</td>");
    expect(page).toContain("<td>1 h ago</td>");
    expect(page).toContain("<td>1 d ago</td>");
  });
});

describe("Fleet unhappy path", () => {
  it("marks a server silent, its stats withheld, once three heartbeats are overdue", async () => {
    const page = await render(Fleet({ servers: [silent] }));
    expect(page).toContain(
      '<tr><td>attic</td><td>https://qemu-b.example.com</td><td colspan="3"><strong>silent</strong></td><td>7</td><td>5 min ago</td>',
    );
    expect(page).not.toContain("50.0%");
  });

  it("is not silent at ninety seconds and is at ninety-one", async () => {
    const onTime = await render(Fleet({ servers: [{ ...alive, heartbeatAt: ago(90) }] }));
    expect(onTime).toContain("<td>2</td><td>31.5 / 66.9 GB</td>");
    expect(onTime).not.toContain("silent");
    const overdue = await render(Fleet({ servers: [{ ...alive, heartbeatAt: ago(91) }] }));
    expect(overdue).toContain(
      '<td colspan="3"><strong>silent</strong></td><td>42</td><td>1 min ago</td>',
    );
  });

  it("says never heard from for a server an operator added that has not announced itself", async () => {
    const page = await render(Fleet({ servers: [neverHeardFrom] }));
    expect(page).toContain(
      '<tr><td>—</td><td>https://qemu-c.example.com</td><td colspan="3">never heard from</td><td>0</td><td>never</td>',
    );
  });

  it("escapes a url and a name in the row and in its delete form", async () => {
    const hostile: Server = {
      ...neverHeardFrom,
      url: 'http://a"b.example.com/<x>',
      name: 'rack<"1>',
    };
    const page = await render(Fleet({ servers: [hostile] }));
    expect(page).toContain(
      "<td>rack&lt;&quot;1&gt;</td><td>http://a&quot;b.example.com/&lt;x&gt;</td>",
    );
    expect(page).toContain('value="http://a&quot;b.example.com/&lt;x&gt;"');
    expect(page).not.toContain('a"b');
    expect(page).not.toContain("<x>");
    expect(page).not.toContain('rack<"1>');
  });
});

describe("Queue happy path", () => {
  it("lists what is running, what is pending, and what completed, each under its heading as a table of the same columns", async () => {
    const page = await render(Queue({ queue: QUEUE }));
    expect(page).toContain(`<h3>running 1</h3><table>${JOB_COLUMNS}`);
    expect(page).toContain(`<h3>pending 1</h3><table>${JOB_COLUMNS}`);
    expect(page).toContain(`<h3>completed</h3><table>${JOB_COLUMNS}`);
    expect(bucket(page, "running 1")).toContain(">OLI-61</a>");
    expect(bucket(page, "pending 1")).toContain(">OLI-62</a>");
    expect(bucket(page, "completed")).toContain(">OLI-60</a>");
  });

  it("puts how many jobs are running and pending next to those headings, and not a count of completed", async () => {
    const page = await render(Queue({ queue: QUEUE }));
    expect(page).toContain("<h3>running 1</h3>");
    expect(page).toContain("<h3>pending 1</h3>");
    expect(page).toContain("<h3>completed</h3>");
    expect(page).not.toContain("<h3>completed ");
  });

  it("lists how many suites are pending, running, succeeded and failed, and pills them finished then running then pending", async () => {
    const page = await render(Queue({ queue: QUEUE }));
    expect(page).toContain("<p>pending 1 · running 1 · succeeded 4 · failed 1</p>");
    expect(page).toContain('<ul class="definition-runs" aria-label="Test suites">');
    const passed = listItem(page, PASSED_RUN.slice(0, 6));
    const failedSuite = listItem(page, FAILED_RUN.slice(0, 6));
    const runningSuite = listItem(page, RUNNING_RUN.slice(0, 6));
    const pendingSuite = listItem(page, PENDING_RUN.slice(0, 6));
    expect(passed).toContain('class="definition-pill definition-pill--passed"');
    expect(passed).toContain(">succeeded<");
    expect(passed).toContain("0 pending · 0 running · 8 passed · 0 failed");
    expect(passed).toContain('datetime="2026-09-09T15:00:00.000Z"');
    expect(passed).toContain(">1 h ago<");
    expect(passed).not.toContain("close");
    expect(failedSuite).toContain('class="definition-pill definition-pill--failed"');
    expect(failedSuite).toContain(">failed<");
    expect(failedSuite).toContain("0 pending · 0 running · 1 passed · 2 failed");
    expect(failedSuite).not.toContain(closeForm(FAILED_RUN));
    expect(runningSuite).toContain('class="definition-pill definition-pill--running"');
    expect(runningSuite).toContain(">running<");
    expect(runningSuite).toContain("0 pending · 1 running · 0 passed · 2 failed");
    expect(runningSuite).toContain(closeForm(RUNNING_RUN));
    expect(pendingSuite).toContain('class="definition-pill definition-pill--pending"');
    expect(pendingSuite).toContain(">pending<");
    expect(pendingSuite).toContain("3 pending · 0 running · 0 passed · 0 failed");
    expect(pendingSuite).toContain(closeForm(PENDING_RUN));
    expect(page.indexOf(PASSED_RUN.slice(0, 6))).toBeLessThan(page.indexOf(FAILED_RUN.slice(0, 6)));
    expect(page.indexOf(FAILED_RUN.slice(0, 6))).toBeLessThan(
      page.indexOf(RUNNING_RUN.slice(0, 6)),
    );
    expect(page.indexOf(RUNNING_RUN.slice(0, 6))).toBeLessThan(
      page.indexOf(PENDING_RUN.slice(0, 6)),
    );
  });

  it("uses the totals, not how many rows the fifty-row lists still show", async () => {
    const page = await render(
      Queue({
        queue: {
          ...EMPTY_QUEUE,
          running: [running],
          runningCount: 60,
          pendingCount: 52,
          suites: { ...SUITES_QUIET, pending: 4, running: 3, passed: 2, failed: 1 },
        },
      }),
    );
    expect(page).toContain("<h3>running 60</h3>");
    expect(page).toContain("<h3>pending 52</h3><p>none</p>");
    expect(page).toContain("<p>pending 4 · running 3 · succeeded 2 · failed 1</p>");
  });

  it("shows a running job's ticket, test, action and status, how long ago it was queued and started, and no finish yet", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, running: [running] } }));
    expect(page).toContain(
      ticketRow(
        "OLI-61",
        ["lock-screen", "diagnose", "running", "3 min ago", "45 s ago", "—", ""],
        abortForm("OLI-61", "diagnose"),
      ),
    );
  });

  it("offers to abort a running job that has a ticket, and asks are you sure before it posts", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, running: [running] } }));
    expect(page).toContain(abortForm("OLI-61", "diagnose"));
    expect(page).toContain('hx-confirm="are you sure?"');
    expect(page).not.toContain(">abort</button>");
  });

  it("shows a pending job as queued and not yet started or finished, with the same abort", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, pending: [pending] } }));
    expect(page).toContain(
      ticketRow(
        "OLI-62",
        ["install", "drive", "pending", "7 s ago", "—", "—", ""],
        abortForm("OLI-62", "drive"),
      ),
    );
  });

  it("offers to abort a pending job that has a ticket, posting to the same route as a running one", async () => {
    const page = await render(
      Queue({ queue: { ...EMPTY_QUEUE, running: [running], pending: [pending] } }),
    );
    expect(page).toContain(abortForm("OLI-62", "drive"));
    expect(page.match(/action="\/abort"/g)?.length).toBe(2);
    expect(page.match(/hx-confirm="are you sure\?"/g)?.length).toBe(2);
  });

  it("names each row's own action when one ticket has a running drive and a pending diagnose", async () => {
    const drive: AutomationJob = { ...running, ticket: "OLI-63", action: "drive" };
    const diagnose: AutomationJob = { ...pending, ticket: "OLI-63", action: "diagnose" };
    const page = await render(
      Queue({ queue: { ...EMPTY_QUEUE, running: [drive], pending: [diagnose] } }),
    );
    expect(page).toContain(abortForm("OLI-63", "drive"));
    expect(page).toContain(abortForm("OLI-63", "diagnose"));
  });

  it("shows a completed job's terminal status, when it finished, and the reason it closed with", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, completed: [failed] } }));
    expect(page).toContain(
      ticketRow(
        "OLI-60",
        ["wifi", "drive", "failed", "1 h ago", "1 h ago", "10 min ago", "session timed out"],
        "",
      ),
    );
    expect(page).toContain('href="https://linear.app/issue/OLI-60"');
    expect(page).toContain('href="/tickets/OLI-60"');
  });

  it("lists the jobs in the order it is given: the database sorted them", async () => {
    const other: AutomationJob = { ...pending, ticket: "OLI-70" };
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, pending: [other, pending] } }));
    expect(page.indexOf(">OLI-70</a>")).toBeLessThan(page.indexOf(">OLI-62</a>"));
  });
});

describe("Queue unhappy path", () => {
  it("says none under a heading with nothing in its list, and draws no table for it", async () => {
    const page = await render(Queue({ queue: EMPTY_QUEUE }));
    expect(page).toBe(
      "<p>pending 0 · running 0 · succeeded 0 · failed 0</p><h3>running 0</h3><p>none</p><h3>pending 0</h3><p>none</p><h3>completed</h3><p>none</p>",
    );
  });

  it("names an aborted suite in the count and draws it with the finished pills, with no close", async () => {
    const stopped = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
    const page = await render(
      Queue({
        queue: {
          ...EMPTY_QUEUE,
          suites: {
            ...SUITES_QUIET,
            aborted: 1,
            pills: [suitePill(stopped, "aborted", ago(86_400))],
          },
        },
      }),
    );
    expect(page).toContain("<p>pending 0 · running 0 · succeeded 0 · failed 0 · aborted 1</p>");
    const item = listItem(page, stopped.slice(0, 6));
    expect(item).toContain('class="definition-pill definition-pill--aborted"');
    expect(item).toContain(">aborted<");
    expect(item).toContain(">1 d ago<");
    expect(item).not.toContain("close");
  });

  it("says a suite started just now when its clock is ahead of the read", async () => {
    const ahead = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const page = await render(
      Queue({
        queue: {
          ...EMPTY_QUEUE,
          suites: {
            ...SUITES_QUIET,
            running: 1,
            pills: [suitePill(ahead, "running", new Date(QUERIED_AT.getTime() + 5_000))],
          },
        },
      }),
    );
    expect(listItem(page, ahead.slice(0, 6))).toContain(">0 s ago<");
  });

  it("escapes a suite name", async () => {
    const page = await render(
      Queue({
        queue: {
          ...EMPTY_QUEUE,
          suites: {
            ...SUITES,
            pills: [{ ...SUITES.pills[0], name: 'a<"b' }],
          },
        },
      }),
    );
    expect(page).toContain("a&lt;&quot;b");
    expect(page).not.toContain('a<"b');
  });

  it("shows a dash for a job whose result has no ticket yet", async () => {
    const page = await render(
      Queue({ queue: { ...EMPTY_QUEUE, pending: [{ ...pending, ticket: null }] } }),
    );
    expect(page).toContain("<tr><td>—</td><td>install</td><td>drive</td><td>pending</td>");
  });

  it("offers no abort on completed, or on a running or pending job with no ticket", async () => {
    const page = await render(
      Queue({
        queue: {
          ...EMPTY_QUEUE,
          running: [{ ...running, ticket: null }],
          pending: [{ ...pending, ticket: null }],
          completed: [
            failed,
            { ...failed, ticket: "OLI-59", status: "aborted", reason: "aborted" },
          ],
        },
      }),
    );
    expect(page).not.toContain('action="/abort"');
    expect(page).not.toContain('hx-confirm="are you sure?"');
    expect(page).not.toContain('aria-label="abort"');
    expect(page).toContain("<tr><td>—</td><td>lock-screen</td><td>diagnose</td>");
    expect(page).toContain("<tr><td>—</td><td>install</td><td>drive</td><td>pending</td>");
    expect(page).toContain('href="https://linear.app/issue/OLI-59"');
    expect(page).toContain('href="/tickets/OLI-59"');
    expect(page).toContain('href="/tickets/OLI-60"');
  });

  it("escapes a ticket, a test name and a reason", async () => {
    const hostile: AutomationJob = {
      ...failed,
      ticket: 'OLI-<1">',
      test: "<b>wifi</b>",
      reason: "<script>alert(1)</script>",
    };
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, completed: [hostile] } }));
    expect(page).toContain(
      `<td><a class="ticket" href="https://linear.app/issue/OLI-%3C1%22%3E">OLI-&lt;1&quot;&gt;</a></td>${followCell('OLI-<1">', "&lt;b&gt;wifi&lt;/b&gt;", true)}`,
    );
    expect(page).toContain(followCell('OLI-<1">', "&lt;script&gt;alert(1)&lt;/script&gt;"));
    expect(page).not.toContain('href="https://linear.app/issue/OLI-<1">');
    expect(page).toContain('href="https://linear.app/issue/OLI-%3C1%22%3E"');
    const runningHostile = await render(
      Queue({ queue: { ...EMPTY_QUEUE, running: [{ ...running, ticket: 'OLI-<1">' }] } }),
    );
    expect(runningHostile).toContain(
      '<input type="hidden" name="ticket" value="OLI-&lt;1&quot;&gt;"/><input type="hidden" name="action" value="diagnose"/>',
    );
    expect(runningHostile).not.toContain('value="OLI-<1">');
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<b>wifi");
  });
});

describe("Process happy path", () => {
  it("names a server and reports its newest jobs, cpu, and memory", async () => {
    const page = await render(Process({ series: [processAlive] }));
    expect(page).toContain("<h3>garage</h3>");
    expect(page).toContain("qemu · 12 s ago");
    expect(page).toContain('aria-label="jobs 2 · cpu 37.5% · memory 512.0 MB"');
    expect(page).toContain("memory 512.0 MB");
    expect(page).toContain("jobs 2");
    expect(page).toContain("cpu 37.5%");
    expect(page).not.toContain("<table>");
  });

  it("says no process stats for an empty list, with no cards", async () => {
    const page = await render(Process({ series: [] }));
    expect(page).toBe("<p>no process stats</p>");
  });

  it("reports cpu above 100 percent rather than clipping the reading", async () => {
    const over: ProcessSeries = {
      ...processAlive,
      cpuPercent: 150,
      samples: [
        { jobs: 1, memoryBytes: 1, cpuPercent: 75, reportedAt: ago(42) },
        { jobs: 1, memoryBytes: 1, cpuPercent: 150, reportedAt: ago(12) },
      ],
    };
    const page = await render(Process({ series: [over] }));
    expect(page).toContain('aria-label="jobs 2 · cpu 150.0% · memory 512.0 MB"');
    expect(page).toContain("cpu 150.0%");
  });

  it("still reports a single sample instead of dropping it", async () => {
    const one: ProcessSeries = {
      ...processAlive,
      samples: [{ jobs: 2, memoryBytes: 512_000_000, cpuPercent: 37.5, reportedAt: ago(12) }],
    };
    const page = await render(Process({ series: [one] }));
    expect(page).toContain('aria-label="jobs 2 · cpu 37.5% · memory 512.0 MB"');
    expect(page).toContain("memory 512.0 MB");
    expect(page).toContain("jobs 2");
    expect(page).toContain("cpu 37.5%");
  });
});

describe("Process unhappy path", () => {
  it("collapses a silent process's graphs into one word", async () => {
    const page = await render(Process({ series: [processSilent] }));
    expect(page).toContain("<header><h3>attic</h3><p>automation-client · 5 min ago</p></header>");
    expect(page).toContain("<p><strong>silent</strong></p>");
    expect(page).not.toContain("256.0 MB");
    expect(page).not.toContain("8.0%");
  });

  it("escapes a name", async () => {
    const page = await render(Process({ series: [{ ...processAlive, name: 'x<">' }] }));
    expect(page).toContain("<h3>x&lt;&quot;&gt;</h3>");
    expect(page).not.toContain('x<">');
  });

  it("reports zeros when every sample is zero rather than inventing a reading", async () => {
    const idle: ProcessSeries = {
      ...processAlive,
      jobs: 0,
      memoryBytes: 0,
      cpuPercent: 0,
      samples: [
        { jobs: 0, memoryBytes: 0, cpuPercent: 0, reportedAt: ago(42) },
        { jobs: 0, memoryBytes: 0, cpuPercent: 0, reportedAt: ago(12) },
      ],
    };
    const page = await render(Process({ series: [idle] }));
    expect(page).toContain('aria-label="jobs 0 · cpu 0.0% · memory 0.0 MB"');
    expect(page).toContain("memory 0.0 MB");
    expect(page).toContain("jobs 0");
    expect(page).toContain("cpu 0.0%");
    expect(page).not.toContain("cpu 100.0%");
    expect(page).not.toContain("memory 512.0 MB");
  });
});

describe("ServersPage happy path", () => {
  it("polls the process readings, the automation queue, and the qemu fleet, and offers to add a server", async () => {
    const page = await render(
      ServersPage({
        halves: { queue: QUEUE, servers: [alive, neverHeardFrom], process: [processAlive] },
        error: undefined,
      }),
    );
    expect(page).toContain("<title>oligarchy servers</title>");
    expect(page).toContain('<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0"');
    expect(page).toContain('href="/" aria-current="page">servers</a>');
    expect(page).toContain('href="/definitions">definitions</a>');
    expect(page).toContain("<h1>oligarchy servers</h1>");
    expect(page).toContain(
      '<h2>process</h2><div id="process" hx-get="/servers/process" hx-trigger="every 30s">',
    );
    expect(page).toContain('aria-label="jobs 2 · cpu 37.5% · memory 512.0 MB"');
    expect(page).toContain(
      '<h2>automation</h2><div id="queue" hx-get="/servers/queue" hx-trigger="every 30s">',
    );
    expect(page).toContain("<p>pending 1 · running 1 · succeeded 4 · failed 1</p>");
    expect(page).toContain("<h3>running 1</h3>");
    expect(page).toContain(linearLink("OLI-61"));
    expect(page).toContain(
      '<h2>qemu servers</h2><div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s">',
    );
    expect(page).toContain("<td>http://127.0.0.1:55332</td>");
    expect(page).toContain("<td>https://qemu-c.example.com</td>");
    expect(page).toContain("<h2>add a server</h2>");
    expect(page).toContain(
      '<form method="post" action="/servers"><input name="url" size="60" placeholder="https://qemu.example.com"/><button>add</button></form>',
    );
    expect(page).not.toContain("<h2>servers</h2>");
    expect(page).not.toContain("error:");
  });
});

describe("ServersPage unhappy path", () => {
  it("puts a refusal's reason on top and keeps both halves, so the operator can act where they are", async () => {
    const page = await render(
      ServersPage({
        halves: { queue: QUEUE, servers: [alive], process: [] },
        error: "url must be an http or https url",
      }),
    );
    expect(page).toContain("<p>error: url must be an http or https url</p>");
    expect(page).toContain(linearLink("OLI-61"));
    expect(page).toContain("<td>http://127.0.0.1:55332</td>");
  });

  it("omits both halves' bodies when the database could not be read, rather than claiming an empty queue or fleet", async () => {
    const page = await render(ServersPage({ halves: undefined, error: "internal error" }));
    expect(page).toContain("<p>error: internal error</p>");
    expect(page).not.toContain('id="queue"');
    expect(page).not.toContain("<p>none</p>");
    expect(page).not.toContain('id="fleet"');
    expect(page).not.toContain("no servers registered");
    expect(page).not.toContain('id="process"');
    expect(page).not.toContain("no process stats");
    expect(page).toContain("<h2>automation</h2>");
    expect(page).toContain("<h2>qemu servers</h2>");
    expect(page).toContain("<h2>add a server</h2>");
    expect(page).toContain("<h2>process</h2>");
  });

  it("escapes the reason", async () => {
    const page = await render(
      ServersPage({
        halves: { queue: EMPTY_QUEUE, servers: [], process: [] },
        error: "<script>alert(1)</script>",
      }),
    );
    expect(page).toContain("<p>error: &lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(page).not.toContain("<script>alert");
  });
});
