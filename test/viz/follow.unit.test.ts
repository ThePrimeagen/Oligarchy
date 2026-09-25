import { describe, expect, it } from "vitest";
import { Encoding, Option } from "effect";
import type * as Domain from "../../src/shared/domain.ts";
import * as Follow from "../../src/viz/follow.ts";
import type * as Text from "../../src/viz/text.ts";
import {
  ago,
  garage,
  GOLD,
  LOVE,
  mouse,
  MUTED,
  PINE,
  power,
  QUERIED_AT,
  screendump,
  sendKey,
  SESSION_ID,
  SUBTLE,
  TEXT,
  TINY_PNG,
} from "../support/viz.ts";

const NOW = QUERIED_AT.getTime();
const textOf = (row: Text.Row): string => row.map((piece) => piece.text).join("");
const colorOf = (row: Text.Row, text: string): string | undefined =>
  row.find((piece) => piece.text.trim() === text)?.color;
// A command row: the name, then its age at the column's right edge.
const command = (name: string, age: string): string =>
  `${name.padEnd(Follow.LEFT_COLS - age.length - 2)}  ${age}`;
// A full follow row: the mark and the name, then how long it took at the column's right edge.
const timed = (left: string, took: string): string =>
  `${left.padEnd(Follow.LEFT_COLS - 1 - took.length)}${took}`;
// A command the peek read before it finished: its start stamped, no end.
const unfinished = (seconds: number) => ({
  startedAt: ago(seconds).getTime(),
  finishedAt: Option.none(),
});

const peek = Follow.peekFromActions(
  "OLI-61",
  SESSION_ID,
  garage.url,
  [
    { request: sendKey, createdAt: ago(20), finishedAt: null },
    { request: mouse, createdAt: ago(8), finishedAt: null },
    { request: screendump, createdAt: ago(2), finishedAt: null },
  ],
  Option.some(TINY_PNG),
);

describe("peek happy path", () => {
  it("keeps the last three commands, oldest first, and names them from the QMP execute", () => {
    const four = Follow.peekFromActions(
      "OLI-61",
      SESSION_ID,
      garage.url,
      [
        { request: sendKey, createdAt: ago(40), finishedAt: null },
        { request: mouse, createdAt: ago(20), finishedAt: null },
        { request: screendump, createdAt: ago(8), finishedAt: null },
        { request: power, createdAt: ago(2), finishedAt: null },
      ],
      Option.none(),
    );
    expect(four._tag).toBe("peek");
    expect(four.ticket).toBe("OLI-61");
    expect(four.sessionId).toBe(SESSION_ID);
    expect(four.serverUrl).toEqual(Option.some(garage.url));
    expect(four.commands).toEqual([
      { name: "input-send-event", at: ago(20), finishedAt: Option.none() },
      { name: "screendump", at: ago(8), finishedAt: Option.none() },
      { name: "system_powerdown", at: ago(2), finishedAt: Option.none() },
    ]);
  });

  it("titles itself with the ticket and the session's first eight characters, and lists each command with its age", () => {
    expect(Follow.title(peek)).toBe("follow OLI-61 · 7a2d0000");
    const rows = Follow.peekRows(peek, NOW);
    expect(rows).toHaveLength(Follow.PEEK_IMAGE_ROWS);
    expect(rows.map(textOf)).toEqual([
      command("send-key", "20 s ago"),
      command("input-send-event", "8 s ago"),
      command("screendump", "2 s ago"),
    ]);
    for (const row of rows.map(textOf)) {
      expect(row).toHaveLength(Follow.LEFT_COLS);
    }
    expect(colorOf(rows[0] ?? [], "send-key")).toBe(TEXT);
    expect(colorOf(rows[0] ?? [], "20 s ago")).toBe(SUBTLE);
    // The ages move with the clock.
    expect(Follow.peekRows(peek, NOW + 60_000).map(textOf)[0]).toBe(
      command("send-key", "1 min ago"),
    );
    expect(Follow.PEEK_HINT).toBe("F full screen   esc close");
  });
});

describe("peek unhappy path", () => {
  it("shows fewer than three when that is all there is, ? for a request with no execute, and says so with none", () => {
    const one = Follow.peekFromActions(
      "OLI-61",
      SESSION_ID,
      null,
      [{ request: { nope: true }, createdAt: ago(1), finishedAt: null }],
      Option.none(),
    );
    expect(one.serverUrl).toEqual(Option.none());
    expect(one.commands).toEqual([{ name: "?", at: ago(1), finishedAt: Option.none() }]);
    expect(Follow.peekRows(one, NOW).map(textOf)).toEqual([command("?", "1 s ago"), "", ""]);
    const empty = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
    const rows = Follow.peekRows(empty, NOW);
    expect(rows.map(textOf)).toEqual(["no commands yet", "", ""]);
    expect(colorOf(rows[0] ?? [], "no commands yet")).toBe(MUTED);
  });

  it("cuts a long command name to the column, keeping its age", () => {
    const long = Follow.peekFromActions(
      "OLI-61",
      SESSION_ID,
      garage.url,
      [{ request: { execute: "x".repeat(80) }, createdAt: ago(2), finishedAt: null }],
      Option.none(),
    );
    const [row] = Follow.peekRows(long, NOW).map(textOf);
    expect(row).toHaveLength(Follow.LEFT_COLS);
    expect(row?.endsWith("…  2 s ago")).toBe(true);
  });
});

describe("full follow happy path", () => {
  it("folds live events on top of the peek's last commands", () => {
    const started = Follow.expand(peek, garage.url);
    expect(started._tag).toBe("full");
    expect(started.status).toBe("pending");
    expect(started.entries).toEqual([
      { id: -1, indent: 0, name: "send-key", state: "completed", ...unfinished(20) },
      { id: -2, indent: 0, name: "input-send-event", state: "completed", ...unfinished(8) },
      { id: -3, indent: 0, name: "screendump", state: "completed", ...unfinished(2) },
    ]);
    expect(started.png).toEqual(Option.some(TINY_PNG));
    const view = Follow.apply(
      Follow.apply(started, { type: "session", status: "running" }, NOW),
      {
        type: "action",
        id: 9,
        name: "mouse-click",
        state: "running",
      },
      NOW,
    );
    expect(view.status).toBe("running");
    expect(view.entries.at(-1)).toEqual({
      id: 9,
      indent: 0,
      name: "mouse-click",
      state: "running",
      startedAt: NOW,
      finishedAt: Option.none(),
    });
    const done = Follow.apply(view, { type: "action", id: 9, state: "completed" }, NOW);
    expect(done.entries.at(-1)?.state).toBe("completed");
  });

  it("indents the actions of a running intent, closes the intent with its verdict, and takes a new image", () => {
    const started = Follow.apply(
      Follow.expand(peek, garage.url),
      {
        type: "intent",
        state: "started",
        message: "log in",
      },
      NOW,
    );
    const inside = Follow.apply(
      started,
      {
        type: "action",
        id: 10,
        name: "send-keys",
        state: "running",
      },
      NOW,
    );
    expect(inside.entries.at(-2)).toEqual({
      id: "intent",
      indent: 0,
      name: "log in",
      state: "running",
      startedAt: NOW,
      finishedAt: Option.none(),
    });
    expect(inside.entries.at(-1)).toEqual({
      id: 10,
      indent: 2,
      name: "send-keys",
      state: "running",
      startedAt: NOW,
      finishedAt: Option.none(),
    });
    const failed = Follow.apply(inside, { type: "action", id: 10, state: "failed" }, NOW);
    expect(failed.entries.at(-1)?.state).toBe("failed");
    const cancelled = Follow.apply(failed, { type: "intent", state: "cancelled" }, NOW);
    expect(cancelled.entries.at(-2)?.state).toBe("failed");
    const completed = Follow.apply(
      Follow.apply(started, { type: "intent", state: "completed" }, NOW),
      {
        type: "action",
        id: 11,
        name: "get-image",
        state: "running",
      },
      NOW,
    );
    expect(completed.entries.at(-2)?.state).toBe("completed");
    // After the intent closed, an action stands on its own again.
    expect(completed.entries.at(-1)?.indent).toBe(0);
    const png = Encoding.encodeBase64(TINY_PNG);
    const pictured = Follow.apply(
      { ...started, png: Option.none() },
      { type: "image", id: "x", png },
      NOW,
    );
    expect(pictured.png).toEqual(Option.some(TINY_PNG));
  });

  it("heads the screen with the ticket and the status in its colour, lists the newest entries that fit with their marks, and spins the running ones", () => {
    const full = Follow.apply(
      Follow.apply(Follow.expand(peek, garage.url), { type: "session", status: "running" }, NOW),
      { type: "action", id: 9, name: "mouse-click", state: "running" },
      NOW,
    );
    const header = Follow.fullHeader(full);
    expect(textOf(header)).toBe("following OLI-61 · 7a2d0000 running");
    expect(colorOf(header, "running")).toBe(GOLD);
    expect(colorOf(Follow.fullHeader({ ...full, status: "failed" }), "failed")).toBe(LOVE);
    expect(colorOf(Follow.fullHeader({ ...full, status: "succeeded" }), "succeeded")).toBe(PINE);
    const rows = Follow.fullEntries(full, 10, NOW);
    expect(rows.map(textOf)).toEqual([
      "✓ send-key",
      "✓ input-send-event",
      "✓ screendump",
      timed(`${Follow.SPINNER[0]} mouse-click`, "0.0s"),
    ]);
    expect(colorOf(rows[0] ?? [], "✓")).toBe(PINE);
    expect(colorOf(rows[3] ?? [], Follow.SPINNER[0] ?? "")).toBe(MUTED);
    const ticked = Follow.tick(Follow.tick(full));
    expect(textOf(Follow.fullEntries(ticked, 10, NOW)[3] ?? [])).toBe(
      timed(`${Follow.SPINNER[2]} mouse-click`, "0.0s"),
    );
    // Two rows of room: the newest two.
    expect(Follow.fullEntries(full, 2, NOW).map(textOf)).toEqual([
      "✓ screendump",
      timed(`${Follow.SPINNER[0]} mouse-click`, "0.0s"),
    ]);
    const failed = Follow.apply(full, { type: "action", id: 9, state: "failed" }, NOW);
    expect(colorOf(Follow.fullEntries(failed, 10, NOW)[3] ?? [], "✗")).toBe(LOVE);
    expect(Follow.FULL_FOOT).toBe("esc closes");
  });
});

const STEPS = [
  "Press Super+Escape. The System menu opens.",
  "Click Lock. Use the mouse only. The screen locks.",
  "the desktop must return exactly as left.",
];

const withIntent = (message: string): Follow.Full =>
  Follow.apply(
    Follow.apply(
      Follow.apply(Follow.expand(peek, garage.url), { type: "session", status: "running" }, NOW),
      { type: "intent", state: "started", message },
      NOW,
    ),
    { type: "action", id: 10, name: "send-keys", state: "running" },
    NOW,
  );

describe("ticket session happy path", () => {
  it("shows the step index, the exact intent line, and only that intent's actions", () => {
    const rows = Follow.ticketRows(withIntent(STEPS[1] ?? ""), STEPS, 8).map(textOf);
    expect(rows[0]).toBe("following OLI-61 · 7a2d0000 running");
    expect(rows[1]).toBe("2/3");
    // The line is wider than the column the image sits beside, so it wraps and the words stay.
    expect(rows[2]).toBe(`${Follow.SPINNER[0]} Click Lock. Use the mouse only. The`);
    expect(rows[3]).toBe("  screen locks.");
    expect(rows[4]).toBe(`  ${Follow.SPINNER[0]} send-keys`);
    expect(rows.every((row) => row.length <= Follow.LEFT_COLS)).toBe(true);
    expect(rows.join("\n")).not.toMatch(/send-key(?!s)/);
    expect(colorOf(Follow.ticketRows(withIntent(STEPS[1] ?? ""), STEPS, 8)[1] ?? [], "2/3")).toBe(
      GOLD,
    );
  });

  it("keeps the index and the start of a long line, and the newest action, when the pane is short", () => {
    const long = `${"word ".repeat(30)}end`;
    const rows = Follow.ticketRows(withIntent(long), [long], 4).map(textOf);
    expect(rows[0]).toContain("following OLI-61");
    expect(rows[1]).toBe("1/1");
    expect(rows[2]?.startsWith(`${Follow.SPINNER[0]} word`)).toBe(true);
    expect(rows[3]).toBe(`  ${Follow.SPINNER[0]} send-keys`);
    expect(rows.every((row) => row.length <= Follow.LEFT_COLS)).toBe(true);
  });

  it("places a repeated line at the copy still ahead, and still shows only that intent", () => {
    const steps = ["Click Style.", "Click Theme.", "Click Style."];
    const full = Follow.apply(
      Follow.apply(
        Follow.apply(
          Follow.apply(
            Follow.expand(peek, garage.url),
            { type: "session", status: "running" },
            NOW,
          ),
          { type: "intent", state: "started", message: "Click Theme." },
          NOW,
        ),
        { type: "intent", state: "completed" },
        NOW,
      ),
      { type: "intent", state: "started", message: "Click Style." },
      NOW,
    );
    const rows = Follow.ticketRows(full, steps, 8).map(textOf);
    expect(rows[1]).toBe("3/3");
    expect(rows.join("\n")).toContain("Click Style.");
    expect(rows.join("\n")).not.toContain("Click Theme.");
  });
});

describe("ticket session unhappy path", () => {
  it("shows 0 and no intent yet before the first intent, and hides the peek's old commands", () => {
    const bare = Follow.apply(
      Follow.expand(peek, garage.url),
      {
        type: "session",
        status: "running",
      },
      NOW,
    );
    const rows = Follow.ticketRows(bare, STEPS, 6).map(textOf);
    expect(rows[1]).toBe("0/3");
    expect(rows.join("\n")).toContain("no intent yet");
    expect(rows.join("\n")).not.toMatch(/send-key(?!s)/);
  });

  it("shows a dash when the open intent is not a step, and still shows what was said", () => {
    const rows = Follow.ticketRows(withIntent("lock the screen"), STEPS, 6);
    expect(textOf(rows[1] ?? [])).toBe("—/3");
    expect(colorOf(rows[1] ?? [], "—/3")).toBe(MUTED);
    expect(rows.map(textOf).join("\n")).toContain("lock the screen");
    expect(rows.map(textOf).join("\n")).toContain("send-keys");
  });
});

describe("full follow unhappy path", () => {
  it("strips control characters from an intent so they cannot steer the terminal, and cuts a long one", () => {
    const dirty = Follow.apply(
      Follow.expand(peek, garage.url),
      {
        type: "intent",
        state: "started",
        message: `wait\nfor\x1b[31mthe boot ${"x".repeat(60)}`,
      },
      NOW,
    );
    const [row] = Follow.fullEntries(dirty, 1, NOW).map(textOf);
    expect(row).not.toContain("\n");
    expect(row).not.toContain("\x1b");
    expect(row?.startsWith(`${Follow.SPINNER[0]} wait for [31mthe boot`)).toBe(true);
    expect(row).toHaveLength(Follow.LEFT_COLS - 1);
    expect(row?.endsWith("…")).toBe(true);
  });

  it("keeps at most two hundred entries, the newest", () => {
    let full = Follow.expand(
      Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none()),
      garage.url,
    );
    for (let id = 0; id < Follow.MAX_ENTRIES + 5; id += 1) {
      full = Follow.apply(full, { type: "action", id, name: "send-keys", state: "running" }, NOW);
    }
    expect(full.entries).toHaveLength(Follow.MAX_ENTRIES);
    expect(full.entries[0]?.id).toBe(5);
    // A verdict for an entry that fell off changes nothing.
    expect(Follow.apply(full, { type: "action", id: 1, state: "completed" }, NOW)).toEqual(full);
    // An intent verdict with no intent running changes nothing either.
    expect(Follow.apply(full, { type: "intent", state: "completed" }, NOW)).toEqual(full);
  });
});

// A session followed from its start: every event stamped with the clock it arrived at.
const live = Follow.apply(
  Follow.expand(
    Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none()),
    garage.url,
  ),
  { type: "session", status: "running" },
  NOW,
);
const arrive = (
  view: Follow.Full,
  events: ReadonlyArray<readonly [Domain.FollowEvent, number]>,
): Follow.Full => events.reduce((held, [event, at]) => Follow.apply(held, event, at), view);
const twoActions = arrive(live, [
  [{ type: "action", id: 1, name: "mouse-move", state: "running" }, NOW],
  [{ type: "action", id: 1, state: "completed" }, NOW + 300],
  [{ type: "action", id: 2, name: "get-image", state: "running" }, NOW + 4_500],
  [{ type: "action", id: 2, state: "completed" }, NOW + 5_600],
]);

describe("action timings happy path", () => {
  it("stamps each action with the time it arrived and the time its verdict did", () => {
    expect(twoActions.entries).toEqual([
      {
        id: 1,
        indent: 0,
        name: "mouse-move",
        state: "completed",
        startedAt: NOW,
        finishedAt: Option.some(NOW + 300),
      },
      {
        id: 2,
        indent: 0,
        name: "get-image",
        state: "completed",
        startedAt: NOW + 4_500,
        finishedAt: Option.some(NOW + 5_600),
      },
    ]);
  });

  it("shows how long each action took, with a processing row for the time from one action's end to the next one's start", () => {
    expect(Follow.fullEntries(twoActions, 10, NOW + 5_600).map(textOf)).toEqual([
      timed("✓ mouse-move", "0.3s"),
      timed("· processing", "4.2s"),
      timed("✓ get-image", "1.1s"),
      timed("· processing", "0.0s"),
    ]);
    // While nothing runs, the last processing row counts up to now.
    expect(
      Follow.fullEntries(twoActions, 10, NOW + 9_000)
        .map(textOf)
        .at(-1),
    ).toBe(timed("· processing", "3.4s"));
  });

  it("a running action counts up, and the processing before it is how long the command took to arrive", () => {
    const running = arrive(twoActions, [
      [{ type: "action", id: 3, name: "mouse-click", state: "running" }, NOW + 9_000],
    ]);
    expect(
      Follow.fullEntries(running, 10, NOW + 9_500)
        .map(textOf)
        .slice(-2),
    ).toEqual([timed("· processing", "3.4s"), timed(`${Follow.SPINNER[0]} mouse-click`, "0.5s")]);
  });

  it("the processing before the first action of a new step sits under that step", () => {
    const stepped = arrive(live, [
      [{ type: "action", id: 1, name: "mouse-move", state: "running" }, NOW],
      [{ type: "action", id: 1, state: "completed" }, NOW + 300],
      [{ type: "intent", state: "started", message: "Click Lock." }, NOW + 2_000],
      [{ type: "action", id: 2, name: "mouse-click", state: "running" }, NOW + 2_100],
      [{ type: "action", id: 2, state: "completed" }, NOW + 2_400],
    ]);
    expect(Follow.fullEntries(stepped, 10, NOW + 2_400).map(textOf)).toEqual([
      timed("✓ mouse-move", "0.3s"),
      `${Follow.SPINNER[0]} Click Lock.`,
      timed("  · processing", "1.8s"),
      timed("  ✓ mouse-click", "0.3s"),
      timed("  · processing", "0.0s"),
    ]);
  });
});

describe("action timings unhappy path", () => {
  it("counts no processing before the first action, and none after the last once the session is over", () => {
    const over = Follow.apply(twoActions, { type: "session", status: "succeeded" }, NOW + 6_000);
    expect(Follow.fullEntries(over, 10, NOW + 60_000).map(textOf)).toEqual([
      timed("✓ mouse-move", "0.3s"),
      timed("· processing", "4.2s"),
      timed("✓ get-image", "1.1s"),
    ]);
  });

  it("a failed action still shows how long it took, and the time since", () => {
    const failed = arrive(live, [
      [{ type: "action", id: 1, name: "mouse-move", state: "running" }, NOW],
      [{ type: "action", id: 1, state: "failed" }, NOW + 1_200],
    ]);
    expect(Follow.fullEntries(failed, 10, NOW + 2_000).map(textOf)).toEqual([
      timed("✗ mouse-move", "1.2s"),
      timed("· processing", "0.8s"),
    ]);
  });

  it("a command the peek read before it finished shows no time, and no processing is counted from it", () => {
    const mixed = Follow.peekFromActions(
      "OLI-61",
      SESSION_ID,
      garage.url,
      [
        { request: sendKey, createdAt: ago(20), finishedAt: ago(19) },
        { request: screendump, createdAt: ago(2), finishedAt: null },
        { request: mouse, createdAt: ago(1), finishedAt: ago(1) },
      ],
      Option.none(),
    );
    expect(mixed.commands.map((sent) => sent.finishedAt)).toEqual([
      Option.some(ago(19)),
      Option.none(),
      Option.some(ago(1)),
    ]);
    expect(Follow.fullEntries(Follow.expand(mixed, garage.url), 10, NOW).map(textOf)).toEqual([
      timed("✓ send-key", "1.0s"),
      timed("· processing", "17.0s"),
      "✓ screendump",
      timed("✓ input-send-event", "0.0s"),
    ]);
  });
});
