import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import { TestMissingPage, TestPage } from "../../src/dashboard/diagnostic.tsx";
import type { TestDump } from "../../src/dashboard/query.ts";

const render = async (element: ReturnType<typeof TestPage>): Promise<string> =>
  String(await html`${element}`);

const dump = (extra: Partial<TestDump> = {}): TestDump => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "lock-screen",
  version: 2,
  description: "the lock screen",
  instruction: "lock it",
  proof: "it is locked",
  status: "failed",
  reason: "the screen stayed unlocked",
  model: "grok-4.6",
  ticket: "OLI-9",
  sessionId: "22222222-2222-4222-8222-222222222222",
  at: new Date("2026-09-01T00:16:00.000Z"),
  screenshots: ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"],
  logs: [
    {
      level: "info",
      text: "intent start; lock it",
      at: new Date("2026-09-01T00:15:00.000Z"),
    },
    {
      level: "error",
      text: "the screen stayed unlocked",
      at: new Date("2026-09-01T00:16:00.000Z"),
    },
  ],
  ...extra,
});

describe("test diagnostic page happy path", () => {
  it("names the definition that ran and dumps its wording, screenshots, and logs", async () => {
    const htmlText = await render(TestPage({ dump: dump() }));
    expect(htmlText).toContain("<title>oligarchy test</title>");
    expect(htmlText).toContain('aria-current="page">definitions</a>');
    expect(htmlText).toContain("<h1>lock-screen</h1>");
    expect(htmlText).toContain("v2");
    expect(htmlText).toContain('<a href="/definitions/lock-screen">lock-screen</a>');
    expect(htmlText).toContain("<h2>screenshots</h2>");
    expect(htmlText).toContain("<h2>logs</h2>");
    expect(htmlText).toContain('<p class="wording">the lock screen</p>');
    expect(htmlText).toContain('<p class="wording">lock it</p>');
    expect(htmlText).toContain('<p class="wording">it is locked</p>');
    expect(htmlText).toContain('<img src="/images/33333333-3333-4333-8333-333333333333" alt=""/>');
    expect(htmlText).toContain('<img src="/images/44444444-4444-4444-8444-444444444444" alt=""/>');
    expect(htmlText.indexOf("/images/33333333-3333-4333-8333-333333333333")).toBeLessThan(
      htmlText.indexOf("/images/44444444-4444-4444-8444-444444444444"),
    );
    expect(htmlText).toContain(
      '<pre class="test-logs">info intent start; lock it\nerror the screen stayed unlocked</pre>',
    );
    expect(htmlText).toContain('<p class="test-reason">the screen stayed unlocked</p>');
    expect(htmlText).toContain("grok-4.6");
    expect(htmlText).toContain("OLI-9");
    expect(htmlText).toContain("22222222-2222-4222-8222-222222222222");
  });
});

describe("test diagnostic page unhappy path", () => {
  it("says there is no session, and dumps no screenshots or logs, when none were written", async () => {
    const htmlText = await render(
      TestPage({
        dump: dump({
          status: "passed",
          reason: "not a failure",
          model: null,
          ticket: null,
          sessionId: null,
          screenshots: [],
          logs: [],
        }),
      }),
    );
    expect(htmlText).toContain("<p>no session</p>");
    expect(htmlText).toContain("<p>no screenshots</p>");
    expect(htmlText).toContain("<p>no logs</p>");
    const body = htmlText.slice(htmlText.indexOf("<body>"));
    expect(body).not.toContain("<img");
    expect(body).not.toContain("test-logs");
    expect(body).not.toContain("test-reason");
    expect(htmlText).not.toContain("not a failure");
    expect(htmlText).not.toContain("grok-4.6");
  });

  it("says the result is missing", async () => {
    const htmlText = String(await html`${TestMissingPage({})}`);
    expect(htmlText).toContain("<title>oligarchy test</title>");
    expect(htmlText).toContain("<p>No test result.</p>");
    const body = htmlText.slice(htmlText.indexOf("<body>"));
    expect(body).not.toContain("<img");
    expect(body).not.toContain("test-logs");
  });
});
