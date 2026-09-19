import { describe, expect, it } from "vitest";
import { Option } from "effect";
import * as Follow from "../../src/viz/follow.ts";
import * as View from "../../src/viz/view.ts";
import {
  at,
  diagnosing,
  EMPTY_QUEUE,
  failed,
  garage,
  key,
  pending,
  QUEUE,
  running,
  runner,
  SESSION_ID,
  shown,
  SNAPSHOT,
} from "../support/viz.ts";

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
    // A job that finished under the cursor: the rows above take the selection.
    const gone = shown(SNAPSHOT, {
      tab: "automation",
      cursor: { servers: 0, clients: 2, queue: 0 },
    });
    expect(View.press(gone, key("k")).cursor.clients).toBe(0);
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

  it("A moves nothing: the abort is the runner's; and no key takes the pop-up down, the clock does", () => {
    const start = shown(many);
    const noticed = { ...start, notice: Option.some("aborted drive OLI-61") };
    expect(View.press(noticed, key("a", true))).toEqual(start);
    expect(View.press(start, key("a", true))).toEqual(start);
    const popped = {
      ...start,
      popup: Option.some({ text: View.CANNOT_ABORT, shownAt: 1_000_000 }),
    };
    expect(View.press(popped, key("j")).popup).toEqual(popped.popup);
    expect(View.press(popped, key("escape")).popup).toEqual(popped.popup);
    expect(View.press(popped, key("a", true)).popup).toEqual(popped.popup);
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

  it("q, Q and ctrl-c quit; L alone opens; f and F follow; A alone asks to abort; enter selects", () => {
    expect(View.isAbort(key("a", true))).toBe(true);
    expect(View.isAbort(key("a"))).toBe(false);
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
