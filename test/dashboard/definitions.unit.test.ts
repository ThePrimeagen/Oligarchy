import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import { DefinitionsPage } from "../../src/dashboard/definitions.tsx";
import type { AutomationJob, TestDefinition } from "../../src/dashboard/query.ts";

const wording = (
  id: number,
  name: string,
  description: string,
  instruction: string,
  proof: string,
): TestDefinition => ({
  id,
  name,
  description,
  instruction,
  proof,
  createdAt: new Date("2026-09-01T00:00:00Z"),
});

const lock = [
  wording(1, "lock-screen", "old d", "first", "old p"),
  wording(2, "lock-screen", "new d", "second", "new p"),
];

const install = [wording(4, "install", "install the disk", "boot it", "a desktop")];

const render = async (element: ReturnType<typeof DefinitionsPage>): Promise<string> =>
  String(await html`${element}`);

const page = (
  groups: Parameters<typeof DefinitionsPage>[0]["groups"],
  extra: Partial<Parameters<typeof DefinitionsPage>[0]> = {},
) =>
  render(
    DefinitionsPage({
      groups,
      name: undefined,
      selected: undefined,
      notice: undefined,
      error: undefined,
      running: [],
      ...extra,
    }),
  );

const both = [
  { name: "install", versions: install },
  { name: "lock-screen", versions: lock },
] as const;

describe("DefinitionsPage happy path", () => {
  it("is its own page: the definitions tab, a search, then each name as its own link", async () => {
    const htmlText = await page([...both]);
    expect(htmlText).toContain("<title>oligarchy definitions</title>");
    expect(htmlText).toContain('<script src="/dashboard.js"');
    expect(htmlText).toMatch(/<style>[^<]*body\s*\{[^}]*background:\s*#161616/);
    expect(htmlText).toMatch(/\.search\s*\{[^}]*display:\s*flex/);
    expect(htmlText).toContain(
      '<nav class="tabs" aria-label="Pages"><a href="/">servers</a><a href="/definitions" aria-current="page">definitions</a></nav>',
    );
    expect(htmlText.indexOf('<nav class="tabs"')).toBeLessThan(
      htmlText.indexOf("<h1>oligarchy definitions</h1>"),
    );
    const search = htmlText.indexOf(
      '<search class="search"><input type="search" aria-label="Search definitions" autocomplete="off"/></search>',
    );
    const list = htmlText.indexOf(
      '<ul class="definition-list"><li><a href="/definitions/install">install</a></li><li><a href="/definitions/lock-screen">lock-screen</a></li></ul>',
    );
    const miss = htmlText.indexOf(
      '<p class="definition-miss" hidden="">No definitions match <code></code>.</p>',
    );
    expect(search).toBeGreaterThan(htmlText.indexOf("<h1>oligarchy definitions</h1>"));
    expect(list).toBeGreaterThan(search);
    expect(miss).toBeGreaterThan(list);
    expect(htmlText).not.toContain('method="get"');
    expect(htmlText).not.toContain('name="q"');
    expect(htmlText).not.toContain("<h2>install</h2>");
    expect(htmlText).not.toContain("<h2>lock-screen</h2>");
    expect(htmlText).not.toContain('class="definition__form"');
    expect(htmlText).not.toContain('<p class="wording">');
    expect(htmlText).not.toContain("dashboard.css");
    expect(htmlText).not.toContain("OMARCHY");
    expect(htmlText).not.toContain("error:");
  });

  it("is one definition's page: its wording, not the list", async () => {
    const selected = { name: "lock-screen", versions: lock };
    const htmlText = await page(null, { name: "lock-screen", selected });
    expect(htmlText).toContain("<title>oligarchy definitions</title>");
    expect(htmlText).toContain('<script src="/dashboard.js"');
    expect(htmlText).toMatch(/p\.wording\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(htmlText).toMatch(/button:disabled\s*\{[^}]*opacity:\s*0\.45/);
    expect(htmlText).not.toMatch(/[^-]p\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(htmlText).toContain('aria-current="page">definitions</a>');
    expect(htmlText).not.toContain("<search");
    expect(htmlText).not.toContain('href="/definitions/install"');
    expect(htmlText).toContain("<h2>lock-screen</h2>");
    expect(htmlText).toContain("<h3>v2</h3>");
    expect(htmlText).toContain(
      '<p class="wording">new d</p><p class="wording">second</p><p class="wording">new p</p>',
    );
    expect(htmlText).toContain("<h3>v1</h3>");
    expect(htmlText).toContain(
      '<p class="wording">old d</p><p class="wording">first</p><p class="wording">old p</p>',
    );
    expect(htmlText.indexOf("<h3>v2</h3>")).toBeLessThan(htmlText.indexOf("<h3>v1</h3>"));
    expect(htmlText).toContain(
      '<form method="post" action="/definitions" class="definition__form"><input type="hidden" name="name" value="lock-screen"/>',
    );
    expect(htmlText).toContain(
      '<textarea name="description" rows="3" required="">new d</textarea>',
    );
    expect(htmlText).toContain(
      '<textarea name="instruction" rows="6" required="">second</textarea>',
    );
    expect(htmlText).toContain('<textarea name="proof" rows="3" required="">new p</textarea>');
    expect(htmlText).toContain(
      "Updating writes v3 of lock-screen; the earlier wordings keep their runs.",
    );
    expect(htmlText).toContain('<button type="submit" disabled="">Update</button>');
    expect(htmlText).not.toContain("result-chart");
    expect(htmlText).not.toContain("duration-chart");
    expect(htmlText).not.toContain("error:");
  });

  it("keeps only the current wording and the one before it, newest first", async () => {
    const selected = {
      name: "wide-three",
      versions: [
        wording(1, "wide-three", "d1", "oldest", "p1"),
        wording(2, "wide-three", "d2", "middle", "p2"),
        wording(3, "wide-three", "d3", "newest", "p3"),
      ],
    };
    const htmlText = await page(null, { name: "wide-three", selected });
    expect(htmlText).toContain(
      '<h3>v3</h3><p class="wording">d3</p><p class="wording">newest</p><p class="wording">p3</p>',
    );
    expect(htmlText).toContain(
      '<h3>v2</h3><p class="wording">d2</p><p class="wording">middle</p><p class="wording">p2</p>',
    );
    expect(htmlText).not.toContain("<h3>v1</h3>");
    expect(htmlText).not.toContain('<p class="wording">oldest</p>');
    expect(htmlText).toContain(
      "Updating writes v4 of wide-three; the earlier wordings keep their runs.",
    );
    expect(htmlText).toContain(
      '<textarea name="instruction" rows="6" required="">newest</textarea>',
    );
  });

  it("says no definitions for an empty list, with a search and no edit form", async () => {
    const htmlText = await page([]);
    expect(htmlText).toContain("<h1>oligarchy definitions</h1>");
    expect(htmlText).toContain("<search");
    expect(htmlText).not.toContain("definition-miss");
    expect(htmlText).toContain("<p>no definitions</p>");
    expect(htmlText).toContain('<p class="running-tests__empty">No tests are running.</p>');
    expect(htmlText).not.toContain('class="definition__form"');
    expect(htmlText).not.toContain("<h2>install</h2>");
  });
});

describe("DefinitionsPage unhappy path", () => {
  it("says the definitions are unavailable and lists none when the database could not be read", async () => {
    const htmlText = await page(null, {
      error: "Test definitions are unavailable.",
      running: null,
    });
    expect(htmlText).toContain("<p>error: Test definitions are unavailable.</p>");
    expect(htmlText).not.toContain("no definitions");
    expect(htmlText).not.toContain("<form");
    expect(htmlText).not.toContain("<h2>");
    expect(htmlText).not.toContain('id="running-tests"');
    expect(htmlText).not.toContain("No tests are running.");
  });

  it("names a definition that does not exist and does not open another one", async () => {
    const htmlText = await page([{ name: "lock-screen", versions: lock }], {
      name: "no-such-definition",
    });
    expect(htmlText).toContain("No test definition named <code>no-such-definition</code>.");
    expect(htmlText).not.toContain("<h2>lock-screen</h2>");
    expect(htmlText).not.toContain('href="/definitions/lock-screen"');
    expect(htmlText).toContain('href="/definitions" aria-current="page"');
  });

  it("puts an edit refusal on that definition's page", async () => {
    const selected = { name: "lock-screen", versions: lock };
    const htmlText = await page(null, {
      name: "lock-screen",
      selected,
      notice: "unchanged",
    });
    expect(htmlText).toContain(
      '<p role="alert">Nothing changed: the newest wording already reads like this.</p>',
    );
    expect(htmlText.match(/role="alert"/g)).toHaveLength(1);
    expect(htmlText.indexOf("<h2>lock-screen</h2>")).toBeLessThan(htmlText.indexOf('role="alert"'));
    expect(htmlText).not.toContain("<h2>install</h2>");

    const empty = await page(null, { name: "lock-screen", selected, notice: "empty" });
    expect(empty).toContain('<p role="alert">Every field needs text.</p>');
  });

  it("escapes a name in the list, and a wording on its page", async () => {
    const hostile = [wording(1, 'a<"b>', "d <d>", "i <i>", "p <p>")];
    const listed = await page([{ name: 'a<"b>', versions: hostile }]);
    expect(listed).toContain('<a href="/definitions/a%3C%22b%3E">a&lt;&quot;b&gt;</a>');
    expect(listed).not.toContain('a<"b>');

    const shown = await page(null, {
      name: 'a<"b>',
      selected: { name: 'a<"b>', versions: hostile },
    });
    expect(shown).toContain("<h2>a&lt;&quot;b&gt;</h2>");
    expect(shown).toContain('value="a&lt;&quot;b&gt;"');
    expect(shown).toContain('<p class="wording">d &lt;d&gt;</p>');
    expect(shown).toContain('<p class="wording">i &lt;i&gt;</p>');
    expect(shown).toContain('<p class="wording">p &lt;p&gt;</p>');
    expect(shown).not.toContain('a<"b>');
    expect(shown).not.toContain("<d>");

    const missing = await page(null, { name: "<nope>" });
    expect(missing).toContain("No test definition named <code>&lt;nope&gt;</code>.");
    expect(missing).not.toContain("<nope>");
  });

  it("lists the running jobs it is given, above the wordings, and offers no abort without a ticket", async () => {
    const queriedAt = new Date("2026-09-09T16:00:00Z");
    const startedAt = new Date("2026-09-09T15:59:50Z");
    const running = (ticket: string | null, action: AutomationJob["action"]): AutomationJob => ({
      ticket,
      test: "lock-screen",
      action,
      status: "running",
      reason: null,
      createdAt: startedAt,
      startedAt,
      finishedAt: null,
      queriedAt,
    });
    const htmlText = await page([{ name: "lock-screen", versions: lock }], {
      name: "lock-screen",
      selected: { name: "lock-screen", versions: lock },
      running: [running("RUN-2", "diagnose"), running("RUN-1", "drive"), running(null, "drive")],
    });
    const strip = htmlText.slice(
      htmlText.indexOf('<section class="running-tests"'),
      htmlText.indexOf("<h2>lock-screen</h2>"),
    );
    expect(strip).toContain(
      '<div id="running-tests" hx-get="/definitions/running?name=lock-screen" hx-trigger="every 30s" hx-swap="innerHTML">',
    );
    expect(strip).toContain(
      "<tr><th>test</th><th>action</th><th>ticket</th><th>running</th><th></th></tr>",
    );
    expect(strip.indexOf(">RUN-2<")).toBeLessThan(strip.indexOf(">RUN-1<"));
    expect(strip.indexOf(">RUN-1<")).toBeLessThan(strip.indexOf("<td>—</td>"));
    expect(strip).toContain('<td class="follow"><a href="/tickets/RUN-2">10 s ago</a></td>');
    expect(strip).toContain('<a class="ticket" href="https://linear.app/issue/RUN-2">RUN-2</a>');
    expect(strip).toContain(
      '<form method="post" action="/abort" hx-post="/abort" hx-confirm="are you sure?" hx-target="#running-tests" hx-swap="innerHTML"><input type="hidden" name="ticket" value="RUN-2"/><input type="hidden" name="action" value="diagnose"/><input type="hidden" name="view" value="definitions"/><input type="hidden" name="definition" value="lock-screen"/><button type="submit" class="abort" aria-label="abort"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2L2 10" stroke="red" stroke-width="2" fill="none"></path></svg></button></form>',
    );
    expect(strip).not.toContain("running-tests__open");
    expect(strip.match(/action="\/abort"/g)).toHaveLength(2);
  });
});
