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
    const clients = View.press(View.press(shown(snapshot, { tab: "clients" }), key("j")), key("j"));
    expect(clients.cursor.clients).toBe(2);
    expect(View.press(clients, key("j")).cursor.clients).toBe(2);
    // A job that finished under the cursor: the rows above take the selection.
    const gone = shown(SNAPSHOT, { tab: "clients", cursor: { servers: 0, clients: 2, queue: 0 } });
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

  it("h, l, left and right switch between servers and clients whichever list has the focus, each keeping its own cursor", () => {
    const start = View.press(shown(many), key("j"));
    const clients = View.press(start, key("l"));
    expect(clients.tab).toBe("clients");
    expect(clients.focus).toBe("machines");
    expect(clients.cursor).toEqual({ servers: 1, clients: 0, queue: 0 });
    // One client with one job: j reaches the job, and no further.
    expect(View.press(clients, key("j")).cursor).toEqual({ servers: 1, clients: 1, queue: 0 });
    expect(View.press(View.press(clients, key("j")), key("j")).cursor.clients).toBe(1);
    expect(View.press(clients, key("h")).tab).toBe("servers");
    expect(View.press(clients, key("left")).tab).toBe("servers");
    expect(View.press(start, key("right")).tab).toBe("clients");
    expect(View.press(View.press(clients, key("l")), key("l")).tab).toBe("clients");
    const queue = View.press(start, key("tab"));
    expect(View.press(queue, key("l")).tab).toBe("clients");
    expect(View.press(queue, key("l")).focus).toBe("queue");
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
    expect(View.CANNOT_ABORT).toBe("you cannot abort completed jobs");
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
      tab: "clients",
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

  it("q, Q and ctrl-c quit; L alone opens; f and F follow; A alone aborts", () => {
    expect(View.isAbort(key("a", true))).toBe(true);
    expect(View.isAbort(key("a"))).toBe(false);
    expect(View.isAbort({ name: "a", shift: false, ctrl: true, meta: false })).toBe(false);
    expect(View.isAbort(key("l", true))).toBe(false);
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

  it("follows a running job with a session, and says why not for anything else", () => {
    expect(View.followError(Option.none())).toEqual(Option.some("no job selected"));
    expect(View.followError(Option.some(pending))).toEqual(
      Option.some("follow needs a running job"),
    );
    expect(View.followError(Option.some(failed))).toEqual(
      Option.some("follow needs a running job"),
    );
    expect(View.followError(Option.some({ ...running, sessionId: null }))).toEqual(
      Option.some("the selected job has no session"),
    );
    expect(View.followError(Option.some(running))).toEqual(Option.none());
  });

  it("aborts a pending or running job with a ticket, and says why not for anything else", () => {
    expect(View.abortError(Option.none())).toEqual(Option.some("no job selected"));
    expect(View.abortError(Option.some({ ...running, ticket: null }))).toEqual(
      Option.some("the selected job has no ticket"),
    );
    expect(View.abortError(Option.some(running))).toEqual(Option.none());
    expect(View.abortError(Option.some(pending))).toEqual(Option.none());
    expect(View.abortError(Option.some(diagnosing))).toEqual(Option.none());
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
    expect(View.press(View.initialView, key("l")).tab).toBe("clients");
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
