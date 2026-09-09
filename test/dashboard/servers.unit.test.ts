import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import type { Server } from "../../src/dashboard/query.ts";
import { Fleet, ServersPage } from "../../src/dashboard/servers.tsx";

const QUERIED_AT = new Date("2026-09-09T16:00:00Z");

const heardFrom = (secondsAgo: number): Date => new Date(QUERIED_AT.getTime() - secondsAgo * 1000);

const alive: Server = {
  url: "http://127.0.0.1:55332",
  stats: {
    qemus: 2,
    memory: { totalBytes: 66_900_000_000, usedBytes: 31_500_000_000 },
    cpu: { mean1m: 12.3, mean2m: 11, mean3m: 9.8 },
  },
  generation: 42,
  heartbeatAt: heardFrom(12),
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
  heartbeatAt: heardFrom(5 * 60 + 12),
  queriedAt: QUERIED_AT,
};

const neverHeardFrom: Server = {
  url: "https://qemu-c.example.com",
  stats: null,
  generation: 0,
  heartbeatAt: null,
  queriedAt: QUERIED_AT,
};

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
    const at = (secondsAgo: number): Server => ({ ...alive, heartbeatAt: heardFrom(secondsAgo) });
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
    const onTime = await render(Fleet({ servers: [{ ...alive, heartbeatAt: heardFrom(90) }] }));
    expect(onTime).toContain("<td>2</td><td>31.5 / 66.9 GB</td>");
    expect(onTime).not.toContain("silent");
    const overdue = await render(Fleet({ servers: [{ ...alive, heartbeatAt: heardFrom(91) }] }));
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

describe("ServersPage happy path", () => {
  it("is the fleet under its headings, polling the fleet every thirty seconds, with the add box below", async () => {
    const page = await render(ServersPage({ servers: [alive, neverHeardFrom], error: undefined }));
    expect(page).toContain("<title>oligarchy servers</title>");
    expect(page).toContain('<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0"');
    expect(page).toContain("<h1>oligarchy servers</h1>");
    expect(page).toContain("<h2>servers</h2>");
    expect(page).toContain(
      '<div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s"><table>',
    );
    expect(page).toContain("<td>http://127.0.0.1:55332</td>");
    expect(page).toContain("<td>https://qemu-c.example.com</td>");
    expect(page).toContain("<h2>add a server</h2>");
    expect(page).toContain(
      '<form method="post" action="/servers"><input name="url" size="60" placeholder="https://qemu.example.com"/><button>add</button></form>',
    );
    expect(page).not.toContain("error:");
  });
});

describe("ServersPage unhappy path", () => {
  it("puts a refusal's reason on top and keeps the fleet, so the operator can act where they are", async () => {
    const page = await render(
      ServersPage({ servers: [alive], error: "url must be an http or https url" }),
    );
    expect(page).toContain("<p>error: url must be an http or https url</p>");
    expect(page).toContain("<td>http://127.0.0.1:55332</td>");
  });

  it("omits the fleet section's body when the database could not be read, rather than claiming an empty fleet", async () => {
    const page = await render(ServersPage({ servers: undefined, error: "internal error" }));
    expect(page).toContain("<p>error: internal error</p>");
    expect(page).not.toContain('id="fleet"');
    expect(page).not.toContain("no servers registered");
    expect(page).toContain("<h2>add a server</h2>");
  });

  it("escapes the reason", async () => {
    const page = await render(ServersPage({ servers: [], error: "<script>alert(1)</script>" }));
    expect(page).toContain("<p>error: &lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(page).not.toContain("<script>alert");
  });
});
