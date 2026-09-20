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

describe("DefinitionsPage happy path", () => {
  it("is the servers document: dark text, the definitions tab current, each name as plain text", async () => {
    const htmlText = await page([
      { name: "install", versions: install },
      { name: "lock-screen", versions: lock },
    ]);
    expect(htmlText).toContain("<title>oligarchy definitions</title>");
    expect(htmlText).toContain('<script src="/dashboard.js"');
    expect(htmlText).toMatch(/<style>[^<]*body\s*\{[^}]*background:\s*#161616/);
    expect(htmlText).toMatch(/p\.wording\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(htmlText).toMatch(/button:disabled\s*\{[^}]*opacity:\s*0\.45/);
    expect(htmlText).not.toMatch(/[^-]p\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(htmlText).toContain(
      '<nav class="tabs" aria-label="Pages"><a href="/">servers</a><a href="/definitions" aria-current="page">definitions</a></nav>',
    );
    expect(htmlText.indexOf('<nav class="tabs"')).toBeLessThan(
      htmlText.indexOf("<h1>oligarchy definitions</h1>"),
    );
    expect(htmlText).toContain("<h2>install</h2>");
    expect(htmlText).toContain("<h2>lock-screen</h2>");
    expect(htmlText).toContain('<p class="wording">install the disk</p>');
    expect(htmlText).toContain('<p class="wording">boot it</p>');
    expect(htmlText).toContain('<p class="wording">a desktop</p>');
    const lockScreen = htmlText.slice(htmlText.indexOf("<h2>lock-screen</h2>"));
    expect(lockScreen).toContain("<h3>v2</h3>");
    expect(lockScreen).toContain(
      '<p class="wording">new d</p><p class="wording">second</p><p class="wording">new p</p>',
    );
    expect(lockScreen).toContain("<h3>v1</h3>");
    expect(lockScreen).toContain(
      '<p class="wording">old d</p><p class="wording">first</p><p class="wording">old p</p>',
    );
    expect(lockScreen.indexOf("<h3>v2</h3>")).toBeLessThan(lockScreen.indexOf("<h3>v1</h3>"));
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
    expect(htmlText).not.toContain("dashboard.css");
    expect(htmlText).not.toContain("OMARCHY");
    expect(htmlText).not.toContain("error:");
  });

  it("keeps only the current wording and the one before it, newest first", async () => {
    const htmlText = await page([
      {
        name: "wide-three",
        versions: [
          wording(1, "wide-three", "d1", "oldest", "p1"),
          wording(2, "wide-three", "d2", "middle", "p2"),
          wording(3, "wide-three", "d3", "newest", "p3"),
        ],
      },
    ]);
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

  it("says no definitions for an empty list, with no form", async () => {
    const htmlText = await page([]);
    expect(htmlText).toContain("<h1>oligarchy definitions</h1>");
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

  it("names a definition that does not exist and still lists the ones that do", async () => {
    const htmlText = await page([{ name: "lock-screen", versions: lock }], {
      name: "no-such-definition",
    });
    expect(htmlText).toContain("No test definition named <code>no-such-definition</code>.");
    expect(htmlText).toContain("<h2>lock-screen</h2>");
  });

  it("puts an edit refusal on the selected definition only", async () => {
    const selected = { name: "lock-screen", versions: lock };
    const htmlText = await page([selected, { name: "install", versions: install }], {
      name: "lock-screen",
      selected,
      notice: "unchanged",
    });
    expect(htmlText).toContain(
      '<p role="alert">Nothing changed: the newest wording already reads like this.</p>',
    );
    expect(htmlText.match(/role="alert"/g)).toHaveLength(1);
    expect(htmlText.indexOf("<h2>lock-screen</h2>")).toBeLessThan(htmlText.indexOf('role="alert"'));
    expect(htmlText.indexOf('role="alert"')).toBeLessThan(htmlText.indexOf("<h2>install</h2>"));

    const empty = await page([selected], { name: "lock-screen", selected, notice: "empty" });
    expect(empty).toContain('<p role="alert">Every field needs text.</p>');
  });

  it("escapes a name and a wording", async () => {
    const hostile = [wording(1, 'a<"b>', "d <d>", "i <i>", "p <p>")];
    const htmlText = await page([{ name: 'a<"b>', versions: hostile }], {
      name: "<nope>",
    });
    expect(htmlText).toContain("<h2>a&lt;&quot;b&gt;</h2>");
    expect(htmlText).toContain('value="a&lt;&quot;b&gt;"');
    expect(htmlText).toContain('<p class="wording">d &lt;d&gt;</p>');
    expect(htmlText).toContain('<p class="wording">i &lt;i&gt;</p>');
    expect(htmlText).toContain('<p class="wording">p &lt;p&gt;</p>');
    expect(htmlText).toContain("No test definition named <code>&lt;nope&gt;</code>.");
    expect(htmlText).not.toContain('a<"b>');
    expect(htmlText).not.toContain("<nope>");
    expect(htmlText).not.toContain("<d>");
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
    expect(strip.indexOf(">RUN-2<")).toBeLessThan(strip.indexOf(">RUN-1<"));
    expect(strip.indexOf(">RUN-1<")).toBeLessThan(strip.indexOf(">—</span>"));
    expect(strip).toContain("10 s ago");
    expect(strip).toContain(
      '<form method="post" action="/abort" hx-post="/abort" hx-confirm="are you sure?" hx-target="#running-tests" hx-swap="innerHTML"><input type="hidden" name="ticket" value="RUN-2"/><input type="hidden" name="action" value="diagnose"/><input type="hidden" name="view" value="definitions"/><input type="hidden" name="definition" value="lock-screen"/><button type="submit" class="button button--abort">Abort</button></form>',
    );
    expect(strip.match(/action="\/abort"/g)).toHaveLength(2);
  });
});
