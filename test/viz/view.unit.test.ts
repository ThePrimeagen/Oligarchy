import { describe, expect, it } from "vitest";
import { Option } from "effect";
import * as Follow from "../../src/viz/follow.ts";
import type * as Text from "../../src/viz/text.ts";
import type * as Trail from "../../src/viz/trail.ts";
import * as View from "../../src/viz/view.ts";
import {
  at,
  COLUMNS,
  diagnosing,
  EMPTY_QUEUE,
  failed,
  garage,
  key,
  mouse,
  pending,
  QUEUE,
  QUERIED_AT,
  ROWS,
  running,
  runner,
  READ_AT,
  sendKey,
  SESSION_ID,
  shown,
  SNAPSHOT,
} from "../support/viz.ts";

const textOf = (row: Text.Row): string => row.map((piece) => piece.text).join("");

const fleet = Array.from({ length: 6 }, (_, index) => ({
  ...garage,
  url: `http://10.0.0.${String(index)}`,
  name: `s${String(index)}`,
}));
const many: View.Snapshot = { ...SNAPSHOT, machines: [...fleet, runner], series: [] };

describe("press happy path", () => {
  it("j, k, down, up, g and G move the selection within the tab's machines", () => {
    const start = shown(many);
    const one = View.press(start, key("j"));
    expect(one.cursor).toEqual({ servers: 1, clients: 0, queue: 0 });
    const two = View.press(one, key("down"));
    expect(two.cursor.servers).toBe(2);
    expect(View.press(two, key("k")).cursor.servers).toBe(1);
    expect(View.press(two, key("up")).cursor.servers).toBe(1);
    const end = View.press(start, key("g", true));
    expect(end.cursor.servers).toBe(5);
    expect(View.press(end, key("j")).cursor.servers).toBe(5);
    expect(View.press(end, key("g")).cursor.servers).toBe(0);
    expect(View.press(start, key("k")).cursor.servers).toBe(0);
    expect(View.press(start, key("x"))).toEqual(start);
    expect(View.press(start, key("j")).tab).toBe("servers");
    expect(View.press(start, key("j")).focus).toBe("machines");
  });

  it("j and k walk a tab's cards and the jobs on them as one list, so a card's job can be selected", () => {
    const snapshot: View.Snapshot = {
      ...SNAPSHOT,
      queue: { ...QUEUE, running: [running, diagnosing] },
    };
    // Servers: garage, its drive, the unnamed server. Clients: runner, its drive, its diagnose.
    const start = shown(snapshot);
    const onJob = View.press(start, key("j"));
    expect(onJob.cursor.servers).toBe(1);
    const onNext = View.press(onJob, key("j"));
    expect(onNext.cursor.servers).toBe(2);
    expect(View.press(onNext, key("j")).cursor.servers).toBe(2);
    expect(View.press(start, key("g", true)).cursor.servers).toBe(2);
    expect(View.press(onNext, key("g")).cursor.servers).toBe(0);
    const clients = View.press(
      View.press(shown(snapshot, { tab: "automation" }), key("j")),
      key("j"),
    );
    expect(clients.cursor.clients).toBe(2);
    expect(View.press(clients, key("j")).cursor.clients).toBe(2);
    // A job that finished under the cursor: the marker stays on a ticket, not the header.
    const gone = shown(SNAPSHOT, {
      tab: "automation",
      cursor: { servers: 0, clients: 2, queue: 0 },
    });
    expect(View.press(gone, key("k")).cursor.clients).toBe(1);
  });

  it("tab moves the focus between the machines and the queue; j, k, g and G then move the job selection, clamped to the jobs listed", () => {
    const three = {
      ...SNAPSHOT,
      queue: { ...QUEUE, pending: [{ ...pending, ticket: "OLI-70" }, pending] },
    };
    const start = View.press(View.press(shown(three), key("j")), key("j"));
    const queue = View.press(start, key("tab"));
    expect(queue.focus).toBe("queue");
    expect(queue.tab).toBe("servers");
    expect(queue.cursor).toEqual({ servers: 2, clients: 0, queue: 0 });
    const one = View.press(queue, key("j"));
    expect(one.cursor).toEqual({ servers: 2, clients: 0, queue: 1 });
    expect(View.press(one, key("down")).cursor.queue).toBe(2);
    expect(View.press(View.press(one, key("j")), key("j")).cursor.queue).toBe(2);
    expect(View.press(one, key("k")).cursor.queue).toBe(0);
    expect(View.press(one, key("up")).cursor.queue).toBe(0);
    expect(View.press(queue, key("k")).cursor.queue).toBe(0);
    expect(View.press(queue, key("g", true)).cursor.queue).toBe(2);
    expect(View.press(one, key("g")).cursor.queue).toBe(0);
    // Back to the machines, each list keeping its place; shift-tab goes the same way.
    const back = View.press(one, key("tab"));
    expect(back.focus).toBe("machines");
    expect(back.cursor).toEqual({ servers: 2, clients: 0, queue: 1 });
    expect(View.press(back, key("j")).cursor).toEqual({ servers: 2, clients: 0, queue: 1 });
    expect(View.press(one, key("tab", true)).focus).toBe("machines");
  });

  it("opens on automation; s stays there, t opens tickets, and h and l cycle the three", () => {
    expect(View.initialView.tab).toBe("automation");
    expect(View.press(View.initialView, key("s")).tab).toBe("automation");
    expect(View.press(View.initialView, key("t")).tab).toBe("tickets");
    expect(View.press(View.initialView, key("l")).tab).toBe("servers");
    expect(View.press(View.initialView, key("h")).tab).toBe("tickets");
    expect(View.press(View.press(View.initialView, key("l")), key("l")).tab).toBe("tickets");
    const servers = shown(many);
    expect(View.press(servers, key("s")).tab).toBe("automation");
    expect(View.press(servers, key("l")).tab).toBe("tickets");
    expect(View.press(servers, key("h")).tab).toBe("automation");
  });

  it("L moves nothing: opening the ticket is the runner's, and any key retires the last notice", () => {
    const start = shown(many);
    const noticed = { ...start, notice: Option.some("opened https://linear.app/issue/OLI-61") };
    expect(View.press(noticed, key("l", true))).toEqual(start);
    expect(View.press(noticed, key("j"))).toEqual(View.press(start, key("j")));
    expect(View.press(noticed, key("j")).notice).toEqual(Option.none());
    expect(View.press(noticed, key("x"))).toEqual(start);
    expect(View.press(noticed, key("tab")).notice).toEqual(Option.none());
  });

  it("a moves nothing: the abort is the runner's; and no key takes the pop-up down, the clock does", () => {
    const start = shown(many);
    const noticed = { ...start, notice: Option.some("aborted drive OLI-61") };
    expect(View.press(noticed, key("a"))).toEqual(start);
    expect(View.press(start, key("a"))).toEqual(start);
    expect(View.press(start, key("a", true))).toEqual(start);
    const popped = {
      ...start,
      popup: Option.some({ text: View.CANNOT_ABORT, shownAt: 1_000_000 }),
    };
    expect(View.press(popped, key("j")).popup).toEqual(popped.popup);
    expect(View.press(popped, key("escape")).popup).toEqual(popped.popup);
    expect(View.press(popped, key("a")).popup).toEqual(popped.popup);
    expect(View.press(popped, key("tab")).popup).toEqual(popped.popup);
    expect(View.initialView.popup).toEqual(Option.none());
  });

  it("A's question has the keys while it is up: h, l and the arrows move between yes and no, escape and enter close it, nothing else moves", () => {
    const start = shown(many);
    const asked: View.Confirm = { ticket: "OLI-61", action: "drive", choice: "no" };
    const open = { ...start, confirm: Option.some(asked), notice: Option.some("opened") };
    expect(View.initialView.confirm).toEqual(Option.none());
    const yes = View.press(open, key("h"));
    expect(yes.confirm).toEqual(Option.some({ ...asked, choice: "yes" }));
    expect(yes.notice).toEqual(Option.none());
    expect(View.press(open, key("left")).confirm).toEqual(yes.confirm);
    // yes is the left answer, no the right; a step past either end stays.
    expect(View.press(yes, key("h")).confirm).toEqual(yes.confirm);
    expect(View.press(yes, key("l")).confirm).toEqual(Option.some(asked));
    expect(View.press(yes, key("right")).confirm).toEqual(Option.some(asked));
    expect(View.press(open, key("l")).confirm).toEqual(Option.some(asked));
    // escape closes it; so does enter, whichever the answer: what yes does is the runner's.
    expect(View.press(open, key("escape"))).toEqual(start);
    expect(View.press(open, key("return"))).toEqual(start);
    expect(View.press(yes, key("return"))).toEqual(start);
    // Every other key is the question's too, and moves nothing.
    const retired = { ...open, notice: Option.none() };
    for (const other of ["j", "k", "down", "up", "tab", "g", "x", "f", "q"]) {
      expect(View.press(open, key(other))).toEqual(retired);
    }
    expect(View.press(open, key("g", true))).toEqual(retired);
    expect(View.press(open, key("l", true))).toEqual(retired);
    expect(View.press(open, key("a", true))).toEqual(retired);
    expect(View.press(open, key("a"))).toEqual(retired);
    expect(View.press(open, key("d"))).toEqual(retired);
    // A peek underneath stays up, and so does a pop-up.
    const peek = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
    const overPeek = { ...open, follow: Option.some<Follow.Follow>(peek) };
    expect(View.press(overPeek, key("j")).follow).toEqual(overPeek.follow);
    expect(View.press(overPeek, key("escape")).follow).toEqual(overPeek.follow);
    expect(View.press(overPeek, key("escape")).confirm).toEqual(Option.none());
    const popup = Option.some({ text: View.CANNOT_ABORT, shownAt: 1 });
    expect(View.press({ ...open, popup }, key("return")).popup).toEqual(popup);
  });

  it("the question names the job and marks the answer the keys are on", () => {
    const asked: View.Confirm = { ticket: "OLI-61", action: "drive", choice: "no" };
    expect(View.confirmTitle(asked)).toBe("abort drive OLI-61");
    expect(View.confirmTitle({ ...asked, action: "diagnose", ticket: "OLI-65" })).toBe(
      "abort diagnose OLI-65",
    );
    const text = (row: ReadonlyArray<{ readonly text: string }>) =>
      row.map((piece) => piece.text).join("");
    const no = View.confirmRows(asked);
    expect(no.map(text)).toEqual(["are you sure?", " ", "  yes    ▸ no"]);
    expect(View.confirmRows({ ...asked, choice: "yes" }).map(text)).toEqual([
      "are you sure?",
      " ",
      "▸ yes      no",
    ]);
  });

  it("selects the job the gold marker rests on: one on a card, or the queue's; none on a header", () => {
    const snapshot: View.Snapshot = {
      ...SNAPSHOT,
      queue: { ...QUEUE, running: [running, diagnosing] },
    };
    expect(View.selectedJob(shown(snapshot))).toEqual(Option.none());
    expect(Option.map(View.selectedJob(at(snapshot, { servers: 1 })), (job) => job.ticket)).toEqual(
      Option.some("OLI-61"),
    );
    const clients = shown(snapshot, {
      tab: "automation",
      cursor: { servers: 0, clients: 2, queue: 0 },
    });
    expect(Option.map(View.selectedJob(clients), (job) => job.ticket)).toEqual(
      Option.some("OLI-65"),
    );
    const queue = shown(snapshot, { focus: "queue", cursor: { servers: 0, clients: 0, queue: 2 } });
    expect(Option.map(View.selectedJob(queue), (job) => job.ticket)).toEqual(Option.some("OLI-62"));
    // A cursor past the end rests on the last job.
    const past = shown(snapshot, { focus: "queue", cursor: { servers: 0, clients: 0, queue: 40 } });
    expect(Option.map(View.selectedJob(past), (job) => job.ticket)).toEqual(Option.some("OLI-62"));
  });

  it("q, Q and ctrl-c quit; L alone opens; f and F follow; a alone asks to abort; d opens a definition; enter selects", () => {
    expect(View.isAbort(key("a"))).toBe(true);
    expect(View.isAbort(key("a", true))).toBe(false);
    expect(View.isDefinition(key("d"))).toBe(true);
    expect(View.isDefinition(key("d", true))).toBe(false);
    expect(View.isDefinition({ name: "d", shift: false, ctrl: true, meta: false })).toBe(false);
    expect(View.isAbort({ name: "a", shift: false, ctrl: true, meta: false })).toBe(false);
    expect(View.isAbort(key("l", true))).toBe(false);
    expect(View.isSelect(key("return"))).toBe(true);
    expect(View.isSelect(key("j"))).toBe(false);
    expect(View.isSelect(key("escape"))).toBe(false);
    expect(View.isQuit(key("q"))).toBe(true);
    expect(View.isQuit(key("q", true))).toBe(true);
    expect(View.isQuit({ name: "c", shift: false, ctrl: true, meta: false })).toBe(true);
    expect(View.isQuit(key("c"))).toBe(false);
    expect(View.isQuit({ name: "q", shift: false, ctrl: true, meta: false })).toBe(false);
    expect(View.isQuit({ name: "q", shift: false, ctrl: false, meta: true })).toBe(false);
    expect(View.isQuit(key("x"))).toBe(false);
    expect(View.isOpen(key("l", true))).toBe(true);
    expect(View.isOpen(key("l"))).toBe(false);
    expect(View.isOpen(key("g", true))).toBe(false);
    expect(View.isFollow(key("f"))).toBe(true);
    expect(View.isFollow(key("f", true))).toBe(true);
    expect(View.isFollow(key("g"))).toBe(false);
  });

  it("F moves nothing: opening follow is the runner's; escape closes a peek, and so does any move", () => {
    const start = shown(SNAPSHOT);
    const peek = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
    const open = {
      ...start,
      follow: Option.some<Follow.Follow>(peek),
      notice: Option.some("opened"),
    };
    expect(View.press(open, key("f"))).toEqual({ ...start, follow: Option.some(peek) });
    expect(View.press(open, key("f", true))).toEqual({ ...start, follow: Option.some(peek) });
    expect(View.press(open, key("l", true))).toEqual({ ...start, follow: Option.some(peek) });
    const escaped = View.press(open, key("escape"));
    expect(escaped.follow).toEqual(Option.none());
    expect(escaped.notice).toEqual(Option.none());
    // A navigation key closes the peek and then moves; tab and l close it too.
    const moved = View.press(open, key("j"));
    expect(moved.follow).toEqual(Option.none());
    expect(moved.cursor.servers).toBe(1);
    expect(View.press(open, key("tab")).follow).toEqual(Option.none());
    expect(View.press(open, key("l")).follow).toEqual(Option.none());
    expect(View.press(open, key("x")).follow).toEqual(Option.none());
    // A full follow stays up through the other keys and closes on escape.
    const full = { ...start, follow: Option.some<Follow.Follow>(Follow.expand(peek, garage.url)) };
    expect(View.press(full, key("j")).follow).toEqual(full.follow);
    expect(View.press(full, key("escape")).follow).toEqual(Option.none());
  });

  it("follows a running job, waiting if its session has not started, and says why not otherwise", () => {
    expect(View.followError(Option.none())).toEqual(Option.some("no job selected"));
    expect(View.followError(Option.some(pending))).toEqual(
      Option.some("follow needs a running job"),
    );
    expect(View.followError(Option.some(failed))).toEqual(
      Option.some("follow needs a running job"),
    );
    // A running drive is followed before start writes its session; the runner waits for it.
    expect(View.followError(Option.some({ ...running, sessionId: null }))).toEqual(Option.none());
    // Nothing names the row once the read moves on: no ticket, no session, nowhere to wait.
    expect(View.followError(Option.some({ ...running, sessionId: null, ticket: null }))).toEqual(
      Option.some("the selected job has no session"),
    );
    expect(View.followError(Option.some(running))).toEqual(Option.none());
  });
});

describe("press unhappy path", () => {
  it("clamps a cursor past the end to the last row, and one below zero to the first", () => {
    // A fleet that shrank under the cursor: the first k moves off the last card, not to it.
    const shrunk = at(many, { servers: 40 });
    expect(View.press(shrunk, key("k")).cursor.servers).toBe(4);
    expect(View.press(shrunk, key("j")).cursor.servers).toBe(5);
    const below = at(many, { servers: -3 });
    expect(View.press(below, key("j")).cursor.servers).toBe(1);
    expect(View.press(below, key("k")).cursor.servers).toBe(0);
    // A queue that shrank under the cursor, the same way.
    const three = {
      ...SNAPSHOT,
      queue: { ...QUEUE, pending: [{ ...pending, ticket: "OLI-70" }, pending] },
    };
    const queue = shown(three, { focus: "queue", cursor: { servers: 0, clients: 0, queue: 40 } });
    expect(View.press(queue, key("k")).cursor.queue).toBe(1);
    expect(View.press(queue, key("j")).cursor.queue).toBe(2);
  });

  it("a key before the first read changes the tab or the focus and leaves the cursors at the first", () => {
    expect(View.press(View.initialView, key("j")).cursor).toEqual({
      servers: 0,
      clients: 0,
      queue: 0,
    });
    expect(View.press(View.initialView, key("g", true)).cursor).toEqual({
      servers: 0,
      clients: 0,
      queue: 0,
    });
    expect(View.press(View.initialView, key("l")).tab).toBe("servers");
    expect(View.press(View.initialView, key("tab")).focus).toBe("queue");
    expect(View.press(View.press(View.initialView, key("tab")), key("j")).cursor.queue).toBe(0);
    expect(View.selectedJob(View.initialView)).toEqual(Option.none());
    expect(
      View.selectedJob(shown({ ...SNAPSHOT, queue: EMPTY_QUEUE }, { focus: "queue" })),
    ).toEqual(Option.none());
  });

  it("names both sizes when the terminal is too small", () => {
    expect(View.tooSmall(100, 24)).toBe(
      "viz needs a terminal of at least 135×37 (columns×rows); this one is 100×24",
    );
  });
});

describe("spinner", () => {
  it("turns one frame every 80 milliseconds and wraps after the last", () => {
    expect(View.spinnerAt(READ_AT)).toBe(Follow.SPINNER[0]);
    expect(View.spinnerAt(READ_AT + View.SPIN_MS)).toBe(Follow.SPINNER[1]);
    expect(View.spinnerAt(READ_AT + View.SPIN_MS * Follow.SPINNER.length)).toBe(Follow.SPINNER[0]);
  });

  it("holds the frame until a full 80 milliseconds have passed", () => {
    expect(View.spinnerAt(0)).toBe(Follow.SPINNER[0]);
    expect(View.spinnerAt(View.SPIN_MS - 1)).toBe(Follow.SPINNER[0]);
    expect(View.spinnerAt(READ_AT + View.SPIN_MS - 1)).toBe(View.spinnerAt(READ_AT));
  });
});

describe("sidebar tickets", () => {
  const two: View.Snapshot = {
    ...SNAPSHOT,
    queue: { ...QUEUE, running: [running, diagnosing] },
  };

  it("place snaps a header or a cursor past the end onto a ticket, and leaves a ticket cursor", () => {
    const header = shown(two, { tab: "automation" });
    expect(View.land(header).cursor.clients).toBe(1);
    const onSecond = shown(two, {
      tab: "automation",
      cursor: { servers: 0, clients: 2, queue: 0 },
    });
    expect(View.land(onSecond)).toEqual(onSecond);
    const past = shown(two, {
      tab: "automation",
      cursor: { servers: 0, clients: 40, queue: 0 },
    });
    expect(View.land(past).cursor.clients).toBe(2);
    expect(View.land(View.initialView)).toBe(View.initialView);
  });

  it("place leaves the cursor when there is no ticket to land on (unhappy)", () => {
    const empty = shown({ ...SNAPSHOT, queue: EMPTY_QUEUE }, { tab: "automation" });
    expect(View.land(empty).cursor.clients).toBe(0);
    expect(View.press(empty, key("j")).cursor.clients).toBe(0);
    expect(View.press(empty, key("k")).cursor.clients).toBe(0);
    expect(View.press(empty, key("g", true)).cursor.clients).toBe(0);
  });

  it("j, k, g and G on the sidebar stop only on tickets", () => {
    const start = shown(two, { tab: "automation" });
    const first = View.press(start, key("j"));
    expect(first.cursor.clients).toBe(1);
    expect(View.press(first, key("j")).cursor.clients).toBe(2);
    expect(View.press(first, key("k")).cursor.clients).toBe(1);
    expect(View.press(start, key("g", true)).cursor.clients).toBe(2);
    expect(View.press(View.press(first, key("j")), key("g")).cursor.clients).toBe(1);
  });

  it("d, enter and a move nothing: those commands are the runner's", () => {
    const start = shown(two, { tab: "automation", notice: Option.some("opened") });
    expect(View.press(start, key("d"))).toEqual({ ...start, notice: Option.none() });
    expect(View.press(start, key("return")).cursor).toEqual(start.cursor);
    expect(View.press(start, key("a")).cursor).toEqual(start.cursor);
    expect(View.press(start, key("a", true)).tab).toBe("automation");
  });
});

describe("sheets", () => {
  const wording = {
    name: "lock-screen",
    description: "The screen locks.",
    instruction: "Lock it.",
    proof: "It is locked.",
  };

  it("definitionSheet and infoSheet name the ticket's wording and its row", () => {
    const defined = View.definitionSheet(wording);
    expect(defined.title).toBe("lock-screen");
    expect(defined.offset).toBe(0);
    expect(defined.lines).toEqual([
      "description",
      "The screen locks.",
      "",
      "instruction",
      "Lock it.",
      "",
      "proof",
      "It is locked.",
      "",
    ]);
    const info = View.infoSheet(running, 0);
    expect(info.title).toBe("ticket OLI-61");
    expect(info.lines).toEqual([
      "ticket    OLI-61",
      "test      lock-screen",
      "action    drive",
      "status    running",
      `reason    —`,
      `session   ${SESSION_ID}`,
      `client    ${running.clientUrl ?? ""}`,
      `server    ${running.serverUrl ?? ""}`,
      "queued    3 min ago",
      "started   45 s ago",
      "finished  —",
    ]);
  });

  it("a blank definition part is a dash, and a missing reason is a dash (unhappy)", () => {
    const blank = View.definitionSheet({
      name: "x",
      description: "  ",
      instruction: "",
      proof: "",
    });
    expect(blank.lines).toEqual(["description", "—", "", "instruction", "—", "", "proof", "—", ""]);
    const info = View.infoSheet({ ...running, reason: null, ticket: null, sessionId: null }, 0);
    expect(info.lines[0]).toBe("ticket    —");
    expect(info.lines[4]).toBe("reason    —");
    expect(info.lines[5]).toBe("session   —");
  });

  it("j and k scroll a sheet and escape closes it; other keys leave the board where it is", () => {
    const long = View.definitionSheet({
      ...wording,
      proof: "p".repeat(View.SHEET_WIDTH * 20),
    });
    expect(long.lines.length).toBeGreaterThan(View.SHEET_ROWS);
    const start = shown(SNAPSHOT, { tab: "automation" });
    const open = { ...start, sheet: Option.some(long) };
    const down = View.press(open, key("j"));
    expect(Option.getOrThrow(down.sheet).offset).toBe(1);
    expect(View.press(down, key("k")).sheet).toEqual(Option.some(long));
    expect(Option.getOrThrow(View.press(open, key("k")).sheet).offset).toBe(0);
    const last = long.lines.length - View.SHEET_ROWS;
    const bottom = { ...open, sheet: Option.some({ ...long, offset: last }) };
    expect(Option.getOrThrow(View.press(bottom, key("j")).sheet).offset).toBe(last);
    expect(View.press(open, key("escape")).sheet).toEqual(Option.none());
    expect(View.press(open, key("l")).tab).toBe("automation");
    expect(View.press(open, key("l")).sheet).toEqual(Option.some(long));
    const short = { ...start, sheet: Option.some(View.definitionSheet(wording)) };
    expect(Option.getOrThrow(View.press(short, key("j")).sheet).offset).toBe(0);
  });

  it("a's question wins the keys when a sheet is also up (unhappy)", () => {
    const sheet = View.definitionSheet(wording);
    const asked: View.Confirm = { ticket: "OLI-61", action: "drive", choice: "no" };
    const both = {
      ...shown(SNAPSHOT, { tab: "automation" }),
      sheet: Option.some(sheet),
      confirm: Option.some(asked),
    };
    const pressed = View.press(both, key("j"));
    expect(pressed.sheet).toEqual(Option.some(sheet));
    expect(pressed.confirm).toEqual(Option.some(asked));
    expect(View.press(both, key("escape")).confirm).toEqual(Option.none());
    expect(View.press(both, key("escape")).sheet).toEqual(Option.some(sheet));
  });
});

describe("log pane", () => {
  const MINUTE = 60_000;
  const line = (
    id: number,
    agentId: string | null,
    level: View.StoredLog["level"] = "info",
  ): View.StoredLog => ({ id, level, text: `line ${String(id)}`, location: null, agentId });
  const board = shown(SNAPSHOT, { tab: "automation" });
  const body = (view: View.View): ReadonlyArray<Text.Row> =>
    View.screen(view, READ_AT, COLUMNS, ROWS).body;
  // The colour the pane paints a ticket in.
  const colorIn = (view: View.View, ticket: string): string | undefined =>
    body(view)
      .flat()
      .find((piece) => piece.text === ticket)?.color;
  const tickets = Array.from({ length: 10 }, (_, index) => `OLI-${String(61 + index)}`);

  it("a ticket keeps its colour from one pull to the next, and a new ticket takes the next one", () => {
    const first = View.withLogs(board, [line(1, "OLI-61"), line(2, "OLI-62")], READ_AT);
    const second = View.withLogs(first, [line(3, "OLI-63"), line(4, "OLI-61")], READ_AT + 1_000);
    expect(colorIn(first, "OLI-61")).not.toBe(colorIn(first, "OLI-62"));
    expect(colorIn(second, "OLI-61")).toBe(colorIn(first, "OLI-61"));
    expect(colorIn(second, "OLI-63")).not.toBe(colorIn(second, "OLI-61"));
    expect(colorIn(second, "OLI-63")).not.toBe(colorIn(first, "OLI-62"));
  });

  it("opens each line with its level in capitals and brackets", () => {
    const view = View.withLogs(
      board,
      [line(1, "OLI-61", "warning"), line(2, null, "error"), line(3, "OLI-62")],
      READ_AT,
    );
    const text = body(view).map(textOf).join("\n");
    expect(text).toContain("[WARN] [OLI-61] line 1");
    expect(text).toContain("[ERROR] [global] line 2");
    expect(text).toContain("[INFO] [OLI-62] line 3");
  });

  it("a ticket gone from the tail for an hour gives its colour to the next new one (unhappy)", () => {
    const first = View.withLogs(
      board,
      tickets.map((ticket, index) => line(index + 1, ticket)),
      READ_AT,
    );
    const stillHere = tickets.filter((ticket) => ticket !== "OLI-63");
    const second = View.withLogs(
      first,
      stillHere.map((ticket, index) => line(20 + index, ticket)),
      READ_AT + 30 * MINUTE,
    );
    const third = View.withLogs(
      second,
      [line(40, "OLI-71"), ...stillHere.map((ticket, index) => line(41 + index, ticket))],
      READ_AT + 61 * MINUTE,
    );
    expect(colorIn(third, "OLI-71")).toBe(colorIn(first, "OLI-63"));
    expect(colorIn(third, "OLI-61")).toBe(colorIn(first, "OLI-61"));
  });

  it("a line with no ticket takes no colour from the ones that follow (unhappy)", () => {
    const alone = View.withLogs(board, [line(1, "OLI-61")], READ_AT);
    const after = View.withLogs(board, [line(1, null), line(2, "OLI-61")], READ_AT);
    expect(colorIn(after, "OLI-61")).toBe(colorIn(alone, "OLI-61"));
  });
});

describe("intent pane", () => {
  const PANE = Math.floor((COLUMNS - 4 - 30 - 3) / 2);
  const timed = (left: string, took: string): string => `${left.padEnd(PANE - took.length)}${took}`;
  // The lower half of the automation body, the pane beside the client column.
  const pane = (view: View.View, now: number): ReadonlyArray<string> =>
    View.screen(view, now, COLUMNS, ROWS)
      .body.slice(15)
      .map((row) =>
        textOf(row)
          .slice(30, 30 + PANE)
          .trimEnd(),
      )
      .filter((row) => row !== "");
  // The running drive under the runner, selected.
  const board = shown(SNAPSHOT, {
    tab: "automation",
    cursor: { servers: 0, clients: 1, queue: 0 },
  });
  const stamped = (ms: number): Date => new Date(QUERIED_AT.getTime() + ms);

  it("lists the selected ticket's session newest first, timed on the database's clock", () => {
    const trail: Trail.Trail = {
      sessionId: SESSION_ID,
      intents: [{ text: "intent start; Click Lock.", createdAt: stamped(0) }],
      actions: [
        {
          id: 1,
          request: mouse,
          state: "completed",
          createdAt: stamped(100),
          finishedAt: stamped(400),
        },
        { id: 2, request: sendKey, state: null, createdAt: stamped(4_000), finishedAt: null },
      ],
      image: Option.none(),
    };
    // Five seconds after the board was read is five seconds after the database's now.
    const rows = pane({ ...board, trail: Option.some(trail) }, READ_AT + 5_000);
    expect(rows).toEqual([
      `${View.spinnerAt(READ_AT + 5_000)} Click Lock.`,
      timed(`  ${View.spinnerAt(READ_AT + 5_000)} send-key`, "1.0s"),
      timed("  · processing", "3.6s"),
      timed("  ✓ input-send-event", "0.3s"),
    ]);
  });

  it("before the first read the pane shows the job's open step, and with none says so (unhappy)", () => {
    const stepped = {
      ...board,
      snapshot: Option.some({
        ...SNAPSHOT,
        queue: { ...SNAPSHOT.queue, running: [{ ...running, intent: "Click Lock." }] },
      }),
    };
    expect(pane(stepped, READ_AT)).toEqual(["Click Lock."]);
    expect(pane(board, READ_AT)).toEqual(["no intent"]);
  });
});
