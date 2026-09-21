import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";
import { FollowFrame, type SessionFollow } from "../../src/dashboard/follow.tsx";
import { RunningList } from "../../src/dashboard/definitions.tsx";
import type { AutomationJob } from "../../src/dashboard/query.ts";

const QUERIED_AT = new Date("2026-09-09T16:00:00Z");
const SESSION = "6f1c8e2a-1111-4111-8111-111111111111";
const IMAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

const INSTRUCTION = `<ActionList>
* open a terminal
* type hello
* any crashes or erroneous behavior must be reported.
</ActionList>`;

const follow: SessionFollow = {
  ticket: "OLI-61",
  sessionId: SESSION,
  status: "running",
  imageId: IMAGE,
  instruction: INSTRUCTION,
  waiting: false,
  queriedAt: QUERIED_AT,
  events: [
    { kind: "intent", text: "open a terminal", state: "running", at: ago(12) },
    { kind: "action", name: "screendump", state: "completed", under: true, at: ago(8) },
    { kind: "action", name: "send-key", state: "failed", under: true, at: ago(3) },
    { kind: "action", name: "input-send-event", state: "running", under: true, at: ago(1) },
  ],
};

const render = async (element: ReturnType<typeof FollowFrame>): Promise<string> =>
  String(await html`${element}`);

const job = (ticket: string | null, action: AutomationJob["action"]): AutomationJob => ({
  ticket,
  test: "lock-screen",
  action,
  status: "running",
  reason: null,
  createdAt: ago(180),
  startedAt: ago(45),
  finishedAt: null,
  queriedAt: QUERIED_AT,
});

const definitionsAbort = (ticket: string): string =>
  `<form method="post" action="/abort" hx-post="/abort" hx-confirm="are you sure?" hx-target="#running-tests" hx-swap="innerHTML"><input type="hidden" name="ticket" value="${ticket}"/><input type="hidden" name="action" value="diagnose"/><input type="hidden" name="view" value="definitions"/><input type="hidden" name="definition" value="lock-screen"/><button type="submit" class="abort" aria-label="abort">`;

describe("FollowFrame happy path", () => {
  it("shows the open step, the intents and commands under them, the latest frame, and polls every five seconds", async () => {
    const page = await render(FollowFrame({ follow }));
    expect(page).toContain(
      '<div id="follow" hx-get="/tickets/OLI-61/feed" hx-trigger="every 5s" hx-swap="innerHTML">',
    );
    expect(page).toContain(
      `<h1 id="follow-heading"><a href="https://linear.app/issue/OLI-61">OLI-61</a> · <code>${SESSION}</code> running</h1>`,
    );
    expect(page).not.toContain("following");
    expect(page).toContain("1/2");
    expect(page).toContain("open a terminal");
    expect(page).toContain("screendump");
    expect(page).toContain("8 s ago");
    expect(page).toContain("send-key");
    expect(page).toContain("3 s ago");
    expect(page).toContain("input-send-event");
    expect(page).toContain("1 s ago");
    expect(page).toContain(`src="/images/${IMAGE}"`);
  });

  it("puts the intention above its actions and the newest action first", async () => {
    const page = await render(FollowFrame({ follow }));
    const intent = page.indexOf("open a terminal");
    const newest = page.indexOf("input-send-event");
    const middle = page.indexOf("send-key");
    const older = page.indexOf("screendump");
    expect(intent).toBeGreaterThan(-1);
    expect(intent).toBeLessThan(newest);
    expect(newest).toBeLessThan(middle);
    expect(middle).toBeLessThan(older);
  });

  it("puts the newest intention above the older one, each with its newest action first", async () => {
    const page = await render(
      FollowFrame({
        follow: {
          ...follow,
          events: [
            { kind: "intent", text: "open a terminal", state: "completed", at: ago(40) },
            { kind: "action", name: "mouse-click", state: "completed", under: true, at: ago(30) },
            { kind: "action", name: "send-key", state: "completed", under: true, at: ago(20) },
            { kind: "intent", text: "type hello", state: "running", at: ago(10) },
            { kind: "action", name: "screendump", state: "completed", under: true, at: ago(6) },
            {
              kind: "action",
              name: "input-send-event",
              state: "running",
              under: true,
              at: ago(1),
            },
          ],
        },
      }),
    );
    const latestIntent = page.indexOf("type hello");
    const latest = page.indexOf("input-send-event");
    const second = page.indexOf("screendump");
    const olderIntent = page.indexOf("open a terminal");
    const olderLatest = page.indexOf("send-key");
    const older = page.indexOf("mouse-click");
    expect(latestIntent).toBeGreaterThan(-1);
    expect(latestIntent).toBeLessThan(latest);
    expect(latest).toBeLessThan(second);
    expect(second).toBeLessThan(olderIntent);
    expect(olderIntent).toBeLessThan(olderLatest);
    expect(olderLatest).toBeLessThan(older);
  });

  it("shows the step as unknown when the open intent is not one of the definition's steps", async () => {
    const page = await render(
      FollowFrame({
        follow: {
          ...follow,
          events: [{ kind: "intent", text: "a paraphrase", state: "running", at: ago(4) }],
        },
      }),
    );
    expect(page).toContain("—/2");
  });
});

describe("FollowFrame unhappy path", () => {
  it("waits for a session that has not started, and keeps polling", async () => {
    const page = await render(
      FollowFrame({
        follow: {
          ...follow,
          sessionId: null,
          status: null,
          imageId: null,
          events: [],
          waiting: true,
        },
      }),
    );
    expect(page).toContain("waiting for OLI-61");
    expect(page).toContain("session");
    expect(page).toContain('hx-trigger="every 5s"');
    expect(page).not.toContain("<img");
    expect(page).not.toContain("no commands yet");
  });

  it("says there is no session when the ticket is over and none was started", async () => {
    const page = await render(
      FollowFrame({
        follow: {
          ...follow,
          sessionId: null,
          status: null,
          imageId: null,
          events: [],
          waiting: false,
        },
      }),
    );
    expect(page).toContain("no session");
    expect(page).not.toContain("waiting for");
  });

  it("says there are no commands yet when the session has started without one", async () => {
    const page = await render(FollowFrame({ follow: { ...follow, imageId: null, events: [] } }));
    expect(page).toContain("no commands yet");
    expect(page).toContain("no screenshot yet");
    expect(page).not.toContain("<ol");
  });

  it("does not show a step count when the definition has no action list", async () => {
    const page = await render(FollowFrame({ follow: { ...follow, instruction: "do the thing" } }));
    expect(page).not.toContain("follow__step");
    expect(page).toContain("open a terminal");
  });

  it("does not list a command under an intention it was not taken for", async () => {
    const page = await render(
      FollowFrame({
        follow: {
          ...follow,
          instruction: "do the thing",
          events: [
            { kind: "action", name: "screendump", state: "completed", under: false, at: ago(30) },
            { kind: "intent", text: "open a terminal", state: "completed", at: ago(20) },
            { kind: "action", name: "send-key", state: "completed", under: true, at: ago(10) },
            {
              kind: "action",
              name: "input-send-event",
              state: "completed",
              under: true,
              at: ago(2),
            },
            { kind: "action", name: "mouse-click", state: "failed", under: false, at: ago(1) },
          ],
        },
      }),
    );
    const loose = page.indexOf("mouse-click");
    const intent = page.indexOf("open a terminal");
    const newestUnder = page.indexOf("input-send-event");
    const olderUnder = page.indexOf("send-key");
    const earlier = page.indexOf("screendump");
    expect(loose).toBeGreaterThan(-1);
    expect(loose).toBeLessThan(intent);
    expect(intent).toBeLessThan(newestUnder);
    expect(newestUnder).toBeLessThan(olderUnder);
    expect(olderUnder).toBeLessThan(earlier);
  });

  it("escapes an intent and a command", async () => {
    const page = await render(
      FollowFrame({
        follow: {
          ...follow,
          instruction: "do the thing",
          events: [
            { kind: "intent", text: "<b>boom</b>", state: "completed", at: ago(2) },
            { kind: "action", name: "<i>nope</i>", state: "completed", under: false, at: ago(1) },
          ],
        },
      }),
    );
    expect(page).toContain("&lt;b&gt;boom&lt;/b&gt;");
    expect(page).toContain("&lt;i&gt;nope&lt;/i&gt;");
    expect(page).not.toContain("<b>boom");
    expect(page).not.toContain("<i>nope");
  });
});

describe("RunningList happy path", () => {
  it("is a queue row: the definition stays its link, the ticket goes to Linear, the age opens the session, and abort is the queue's mark", async () => {
    const page = await render(
      RunningList({ jobs: [job("OLI-61", "diagnose")], definition: "lock-screen" }),
    );
    expect(page).toContain(">test<");
    expect(page).toContain(">action<");
    expect(page).toContain(">ticket<");
    expect(page).toContain(">running<");
    expect(page).toContain('<a href="/definitions/lock-screen">lock-screen</a>');
    expect(page).toContain('<a class="ticket" href="https://linear.app/issue/OLI-61">OLI-61</a>');
    expect(page).toContain('<td class="follow"><a href="/tickets/OLI-61">45 s ago</a></td>');
    expect(page).toContain(definitionsAbort("OLI-61"));
    expect(page).not.toContain("running-tests__open");
  });
});

describe("RunningList unhappy path", () => {
  it("offers no follow and no Linear link, and still names the definition, when the job has no ticket", async () => {
    const page = await render(
      RunningList({ jobs: [job(null, "drive")], definition: "lock-screen" }),
    );
    expect(page).toContain("<td>—</td>");
    expect(page).toContain('<a href="/definitions/lock-screen">lock-screen</a>');
    expect(page).not.toContain('href="/tickets/');
    expect(page).not.toContain("linear.app");
    expect(page).not.toContain("running-tests__open");
    expect(page).not.toContain('action="/abort"');
  });
});

const env = {
  HYPERDRIVE: { connectionString: "postgres://user:sentinel-secret-pw@127.0.0.1:1/oligarchy" },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
  LINEAR_API_URL: "http://127.0.0.1:1",
  LINEAR_API_TOKEN: "lin_api_x",
};

describe("GET /tickets unhappy path", () => {
  it("refuses a ticket id that is not a path segment, and does not ask the database", async () => {
    const page = await app.request("/tickets/has.dot", undefined, env);
    const feed = await app.request("/tickets/has.dot/feed", undefined, env);
    const pageHtml = await page.text();
    const feedHtml = await feed.text();
    expect(page.status).toBe(404);
    expect(feed.status).toBe(404);
    expect(pageHtml).not.toContain("sentinel-secret-pw");
    expect(feedHtml).not.toContain("sentinel-secret-pw");
    expect(pageHtml).not.toContain("every 5s");
  });

  it("says the feed is unavailable when the database cannot be reached, and never echoes the password", async () => {
    const page = await app.request("/tickets/OLI-1", undefined, env);
    const feed = await app.request("/tickets/OLI-1/feed", undefined, env);
    expect(page.status).toBe(500);
    expect(feed.status).toBe(500);
    const pageHtml = await page.text();
    const feedHtml = await feed.text();
    expect(pageHtml).toContain("The session feed is unavailable.");
    expect(feedHtml).toBe("<p>error: internal error</p>");
    expect(pageHtml).not.toContain("sentinel-secret-pw");
    expect(feedHtml).not.toContain("sentinel-secret-pw");
  });
});
