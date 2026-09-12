import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import type {
  AutomationJob,
  AutomationQueue,
  ProcessStat,
  Server,
} from "../../src/dashboard/query.ts";
import { Fleet, Process, Queue, ServersPage } from "../../src/dashboard/servers.tsx";

const QUERIED_AT = new Date("2026-09-09T16:00:00Z");

const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

const alive: Server = {
  url: "http://127.0.0.1:55332",
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

const QUEUE: AutomationQueue = { running: [running], pending: [pending], completed: [failed] };
const EMPTY_QUEUE: AutomationQueue = { running: [], pending: [], completed: [] };

const processAlive: ProcessStat = {
  url: "http://127.0.0.1:55332",
  type: "qemu",
  jobs: 2,
  memoryBytes: 512_000_000,
  cpuPercent: 37.5,
  reportedAt: ago(12),
  queriedAt: QUERIED_AT,
};

const processSilent: ProcessStat = {
  url: "http://automation.test:54322",
  type: "automation-client",
  jobs: 1,
  memoryBytes: 256_000_000,
  cpuPercent: 8,
  reportedAt: ago(5 * 60 + 12),
  queriedAt: QUERIED_AT,
};

const PROCESS_COLUMNS =
  "<tr><th>url</th><th>type</th><th>jobs</th><th>memory</th><th>cpu 30s</th><th>reported</th></tr>";

const JOB_COLUMNS =
  "<tr><th>ticket</th><th>test</th><th>action</th><th>status</th><th>queued</th><th>started</th><th>finished</th><th>reason</th><th></th></tr>";

const ABORT_X =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2L2 10" stroke="red" stroke-width="2" fill="none"></path></svg>';

const abortForm = (ticket: string): string =>
  `<form method="post" action="/abort" hx-post="/abort" hx-confirm="are you sure?" hx-target="#queue" hx-swap="innerHTML"><input type="hidden" name="ticket" value="${ticket}"/><button type="submit" class="abort" aria-label="abort">${ABORT_X}</button></form>`;

// The components are functions of their props; the string they render, through the same html
// helper the routes serve them with, is the page. The helper hands back a String object, hence
// the primitive.
const render = async (element: ReturnType<typeof Fleet>): Promise<string> =>
  String(await html`${element}`);

describe("Fleet happy path", () => {
  it("lists a server heard from just now with its machines, memory, the three cpu means, its generation and the age of its heartbeat", async () => {
    const page = await render(Fleet({ servers: [alive] }));
    expect(page).toContain(
      "<tr><th>url</th><th>qemus</th><th>memory</th><th>cpu 1m / 2m / 3m</th><th>generation</th><th>heartbeat</th><th></th></tr>",
    );
    expect(page).toContain(
      "<tr><td>http://127.0.0.1:55332</td><td>2</td><td>31.5 / 66.9 GB</td><td>12.3% / 11.0% / 9.8%</td><td>42</td><td>12 s ago</td>",
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
      '<tr><td>https://qemu-b.example.com</td><td colspan="3"><strong>silent</strong></td><td>7</td><td>5 min ago</td>',
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
      '<tr><td>https://qemu-c.example.com</td><td colspan="3">never heard from</td><td>0</td><td>never</td>',
    );
  });

  it("escapes a url in the row and in its delete form", async () => {
    const hostile: Server = { ...neverHeardFrom, url: 'http://a"b.example.com/<x>' };
    const page = await render(Fleet({ servers: [hostile] }));
    expect(page).toContain("<td>http://a&quot;b.example.com/&lt;x&gt;</td>");
    expect(page).toContain('value="http://a&quot;b.example.com/&lt;x&gt;"');
    expect(page).not.toContain('a"b');
    expect(page).not.toContain("<x>");
  });
});

describe("Queue happy path", () => {
  it("lists what is running, then what is pending, then what completed, each under its heading as a table of the same columns", async () => {
    const page = await render(Queue({ queue: QUEUE }));
    expect(page).toContain(`<h3>running</h3><table>${JOB_COLUMNS}`);
    expect(page).toContain(`<h3>pending</h3><table>${JOB_COLUMNS}`);
    expect(page).toContain(`<h3>completed</h3><table>${JOB_COLUMNS}`);
    expect(page.indexOf("<h3>running</h3>")).toBeLessThan(page.indexOf("<h3>pending</h3>"));
    expect(page.indexOf("<h3>pending</h3>")).toBeLessThan(page.indexOf("<h3>completed</h3>"));
    expect(page.indexOf("<td>OLI-61</td>")).toBeLessThan(page.indexOf("<h3>pending</h3>"));
    expect(page.indexOf("<td>OLI-62</td>")).toBeLessThan(page.indexOf("<h3>completed</h3>"));
    expect(page.indexOf("<td>OLI-60</td>")).toBeGreaterThan(page.indexOf("<h3>completed</h3>"));
  });

  it("shows a running job's ticket, test, action and status, how long ago it was queued and started, and no finish yet", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, running: [running] } }));
    expect(page).toContain(
      `<tr><td>OLI-61</td><td>lock-screen</td><td>diagnose</td><td>running</td><td>3 min ago</td><td>45 s ago</td><td>—</td><td></td><td>${abortForm("OLI-61")}</td></tr>`,
    );
  });

  it("puts a red X on a running job that has a ticket, and asks are you sure before it posts", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, running: [running] } }));
    expect(page).toContain(abortForm("OLI-61"));
    expect(page).toContain('hx-confirm="are you sure?"');
    expect(page).toContain('stroke="red"');
    expect(page).not.toContain(">abort</button>");
  });

  it("shows a pending job as queued and not yet started or finished", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, pending: [pending] } }));
    expect(page).toContain(
      "<tr><td>OLI-62</td><td>install</td><td>drive</td><td>pending</td><td>7 s ago</td><td>—</td><td>—</td><td></td><td></td></tr>",
    );
  });

  it("shows a completed job's terminal status, when it finished, and the reason it closed with", async () => {
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, completed: [failed] } }));
    expect(page).toContain(
      "<tr><td>OLI-60</td><td>wifi</td><td>drive</td><td>failed</td><td>1 h ago</td><td>1 h ago</td><td>10 min ago</td><td>session timed out</td><td></td></tr>",
    );
  });

  it("lists the jobs in the order it is given: the database sorted them", async () => {
    const other: AutomationJob = { ...pending, ticket: "OLI-70" };
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, pending: [other, pending] } }));
    expect(page.indexOf("<td>OLI-70</td>")).toBeLessThan(page.indexOf("<td>OLI-62</td>"));
  });
});

describe("Queue unhappy path", () => {
  it("says none under a heading with nothing in its list, and draws no table for it", async () => {
    const page = await render(Queue({ queue: EMPTY_QUEUE }));
    expect(page).toBe(
      "<h3>running</h3><p>none</p><h3>pending</h3><p>none</p><h3>completed</h3><p>none</p>",
    );
  });

  it("shows a dash for a job whose result has no ticket yet", async () => {
    const page = await render(
      Queue({ queue: { ...EMPTY_QUEUE, pending: [{ ...pending, ticket: null }] } }),
    );
    expect(page).toContain("<tr><td>—</td><td>install</td><td>drive</td><td>pending</td>");
  });

  it("offers no abort on pending, completed, or a running job with no ticket", async () => {
    const page = await render(
      Queue({
        queue: {
          running: [{ ...running, ticket: null }],
          pending: [pending],
          completed: [failed],
        },
      }),
    );
    expect(page).not.toContain('action="/abort"');
    expect(page).not.toContain('hx-confirm="are you sure?"');
    expect(page).not.toContain('aria-label="abort"');
    expect(page).not.toContain("<svg");
  });

  it("escapes a ticket, a test name and a reason", async () => {
    const hostile: AutomationJob = {
      ...failed,
      ticket: 'OLI-<1">',
      test: "<b>wifi</b>",
      reason: "<script>alert(1)</script>",
    };
    const page = await render(Queue({ queue: { ...EMPTY_QUEUE, completed: [hostile] } }));
    expect(page).toContain("<td>OLI-&lt;1&quot;&gt;</td><td>&lt;b&gt;wifi&lt;/b&gt;</td>");
    expect(page).toContain("<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>");
    const runningHostile = await render(
      Queue({ queue: { ...EMPTY_QUEUE, running: [{ ...running, ticket: 'OLI-<1">' }] } }),
    );
    expect(runningHostile).toContain('value="OLI-&lt;1&quot;&gt;"');
    expect(runningHostile).not.toContain('value="OLI-<1">');
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<b>wifi");
  });
});

describe("Process happy path", () => {
  it("lists a process heard from just now with its jobs, memory, 30s cpu and the age of its report", async () => {
    const page = await render(Process({ rows: [processAlive] }));
    expect(page).toContain(PROCESS_COLUMNS);
    expect(page).toContain(
      "<tr><td>http://127.0.0.1:55332</td><td>qemu</td><td>2</td><td>512.0 MB</td><td>37.5%</td><td>12 s ago</td></tr>",
    );
  });

  it("says no process stats for an empty list, with no table", async () => {
    const page = await render(Process({ rows: [] }));
    expect(page).toBe("<p>no process stats</p>");
  });
});

describe("Process unhappy path", () => {
  it("collapses a silent process's readings into one word", async () => {
    const page = await render(Process({ rows: [processSilent] }));
    expect(page).toContain(
      '<tr><td>http://automation.test:54322</td><td>automation-client</td><td colspan="3"><strong>silent</strong></td><td>5 min ago</td></tr>',
    );
    expect(page).not.toContain("256.0 MB");
  });

  it("escapes a url", async () => {
    const page = await render(
      Process({ rows: [{ ...processAlive, url: 'http://x.test/<">' }] }),
    );
    expect(page).toContain("<td>http://x.test/&lt;&quot;&gt;</td>");
    expect(page).not.toContain('http://x.test/<">');
  });
});

describe("ServersPage happy path", () => {
  it("is split in two halves side by side: the automation queue first, the qemu fleet with its add box second, each polled every thirty seconds", async () => {
    const page = await render(
      ServersPage({
        halves: { queue: QUEUE, servers: [alive, neverHeardFrom], process: [processAlive] },
        error: undefined,
      }),
    );
    expect(page).toContain("<title>oligarchy servers</title>");
    expect(page).toContain('<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0"');
    expect(page).toMatch(/<style>[^<]*\.halves\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
    expect(page).toMatch(/<style>[^<]*\.abort\s*\{[^}]*background:\s*none/);
    expect(page).toContain("<h1>oligarchy servers</h1>");
    expect(page).toContain(
      '<div class="halves"><section><h2>automation</h2><div id="queue" hx-get="/servers/queue" hx-trigger="every 30s"><h3>running</h3>',
    );
    expect(page).toContain("<td>OLI-61</td>");
    expect(page).toContain(
      '<section><h2>qemu servers</h2><div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s"><table>',
    );
    expect(page).toContain("<td>http://127.0.0.1:55332</td>");
    expect(page).toContain("<td>https://qemu-c.example.com</td>");
    expect(page).toContain("<h2>add a server</h2>");
    expect(page).toContain(
      '<form method="post" action="/servers"><input name="url" size="60" placeholder="https://qemu.example.com"/><button>add</button></form>',
    );
    expect(page.indexOf("<h2>automation</h2>")).toBeLessThan(page.indexOf("<h2>qemu servers</h2>"));
    expect(page.indexOf("<h2>qemu servers</h2>")).toBeLessThan(
      page.indexOf("<h2>add a server</h2>"),
    );
    expect(page).toContain(
      '<section><h2>process</h2><div id="process" hx-get="/servers/process" hx-trigger="every 30s"><table>',
    );
    expect(page).toContain("<td>37.5%</td>");
    expect(page.indexOf("<h2>add a server</h2>")).toBeLessThan(page.indexOf("<h2>process</h2>"));
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
    expect(page).toContain("<td>OLI-61</td>");
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
