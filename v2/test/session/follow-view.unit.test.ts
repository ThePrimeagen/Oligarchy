import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { type Cause, Effect, Fiber, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as FollowView from "../../src/session/follow-view.ts";
import * as Image from "../../src/session/image.ts";
import * as Domain from "../../src/shared/domain.ts";
import { fakeTty } from "../support/fake-tty.ts";

const FOLLOWED_ID = "7a2d0000-0000-4000-8000-00000000f011";
const IMAGE_ID = "9c4f0000-0000-4000-8000-00000000b2d3";
// A 2x2 RGB PNG (only the IHDR dimensions matter to placement).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVR4nGP4z8DAwPCfgYGB4T8DAwMDAB1cBf6DrvMVAAAAAElFTkSuQmCC",
  "base64",
);
const TINY_PNG_BASE64 = TINY_PNG.toString("base64");

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

const applyAll = (events: ReadonlyArray<Domain.FollowEvent>): FollowView.View =>
  events.reduce(FollowView.apply, FollowView.initialView(FOLLOWED_ID));

describe("follow view state", () => {
  it.effect("folds session, intent, action and image events into entries", () =>
    Effect.sync(() => {
      const view = applyAll([
        { type: "session", status: "running" },
        { type: "intent", state: "started", message: "wait for the boot menu" },
        { type: "action", id: 1, name: "send-keys", state: "running" },
        { type: "action", id: 1, state: "completed" },
        { type: "action", id: 2, name: "send-mouse", state: "running" },
        { type: "action", id: 2, state: "failed" },
        { type: "intent", state: "completed" },
        { type: "action", id: 3, name: "get-serial", state: "running" },
        { type: "image", id: IMAGE_ID, png: TINY_PNG_BASE64 },
      ]);
      expect(view.status).toBe("running");
      expect(view.entries).toEqual([
        { id: "intent", indent: 0, name: "wait for the boot menu", state: "completed" },
        { id: 1, indent: 2, name: "send-keys", state: "completed" },
        { id: 2, indent: 2, name: "send-mouse", state: "failed" },
        { id: 3, indent: 0, name: "get-serial", state: "running" },
      ]);
      expect(Option.isSome(view.png)).toBe(true);
      expect(Option.map(view.png, (png) => Array.from(png))).toEqual(
        Option.some(Array.from(TINY_PNG)),
      );
    }),
  );

  it.effect("a cancelled intent is drawn failed and closes the indentation", () =>
    Effect.sync(() => {
      const view = applyAll([
        { type: "intent", state: "started", message: "first" },
        { type: "intent", state: "cancelled" },
        { type: "action", id: 4, name: "get-image", state: "running" },
      ]);
      expect(view.entries).toEqual([
        { id: "intent", indent: 0, name: "first", state: "failed" },
        { id: 4, indent: 0, name: "get-image", state: "running" },
      ]);
    }),
  );

  it.effect(
    "ignores an action completion for an unknown id and an intent end with no intent open",
    () =>
      Effect.sync(() => {
        const view = applyAll([
          { type: "action", id: 9, state: "completed" },
          { type: "intent", state: "completed" },
          { type: "action", id: 1, name: "send-keys", state: "running" },
          { type: "action", id: 7, state: "failed" },
        ]);
        expect(view.entries).toEqual([{ id: 1, indent: 0, name: "send-keys", state: "running" }]);
      }),
  );

  it.effect("keeps at most MAX_ENTRIES entries, dropping the oldest", () =>
    Effect.sync(() => {
      const events: Array<Domain.FollowEvent> = Array.from({ length: 205 }, (_, index) => ({
        type: "action",
        id: index,
        name: "send-keys",
        state: "running",
      }));
      const view = applyAll(events);
      expect(FollowView.MAX_ENTRIES).toBe(200);
      expect(view.entries).toHaveLength(200);
      expect(view.entries[0]?.id).toBe(5);
      expect(view.entries.at(-1)?.id).toBe(204);
    }),
  );

  it.effect("tick advances the spinner frame", () =>
    Effect.sync(() => {
      const view = FollowView.initialView(FOLLOWED_ID);
      expect(FollowView.tick(view).frame).toBe(1);
      expect(FollowView.tick(FollowView.tick(view)).frame).toBe(2);
    }),
  );
});

describe("follow view drawing", () => {
  it.effect("writes fixed-width lines with absolute moves and never a newline", () =>
    Effect.sync(() => {
      const view = applyAll([
        { type: "session", status: "running" },
        { type: "intent", state: "started", message: "wait for the boot menu" },
        { type: "action", id: 1, name: "send-keys", state: "running" },
        { type: "action", id: 1, state: "completed" },
        { type: "action", id: 2, name: "send-mouse", state: "running" },
        { type: "action", id: 2, state: "failed" },
      ]);
      const out = FollowView.draw(view, 10);
      expect(out).not.toMatch(/\n/);
      const header = "following 7a2d0000 ";
      expect(out.startsWith(`\x1b[1;2H${header}\x1b[33mrunning\x1b[0m`)).toBe(true);
      expect(out).toContain(
        `\x1b[33mrunning\x1b[0m${" ".repeat(FollowView.LEFT_COLS - 1 - header.length - "running".length)}\x1b[2;2H`,
      );
      expect(out).toContain(`\x1b[2;2H\x1b[90m⠋ wait for the boot menu\x1b[0m`);
      expect(out).toContain(`\x1b[3;2H  \x1b[32m✓ send-keys\x1b[0m`);
      expect(out).toContain(`\x1b[4;2H  \x1b[31m✗ send-mouse\x1b[0m`);
      expect(out).toContain(`\x1b[5;2H${" ".repeat(FollowView.LEFT_COLS - 1)}`);
      expect(out).toContain(`\x1b[9;2H${" ".repeat(FollowView.LEFT_COLS - 1)}`);
      expect(out.endsWith(`\x1b[10;2H\x1b[90mctrl-c detaches\x1b[0m`)).toBe(true);
      // Every entry line is padded to the column width after its label.
      expect(out).toContain(
        `✓ send-keys\x1b[0m${" ".repeat(FollowView.LEFT_COLS - 3 - 2 - "send-keys".length)}`,
      );
    }),
  );

  it.effect("colours the header status and cycles the spinner glyph", () =>
    Effect.sync(() => {
      const pending = FollowView.initialView(FOLLOWED_ID);
      expect(FollowView.draw(pending, 5)).toContain("\x1b[90mpending\x1b[0m");
      for (const [status, colour] of [
        ["succeeded", "\x1b[32m"],
        ["failed", "\x1b[31m"],
        ["aborted", "\x1b[91m"],
        ["timed_out", "\x1b[35m"],
      ] as const) {
        expect(FollowView.draw(applyAll([{ type: "session", status }]), 5)).toContain(
          `${colour}${status}\x1b[0m`,
        );
      }
      const running = applyAll([{ type: "action", id: 1, name: "send-keys", state: "running" }]);
      expect(FollowView.draw(running, 5)).toContain("\x1b[90m⠋ send-keys");
      expect(FollowView.draw(FollowView.tick(running), 5)).toContain("\x1b[90m⠙ send-keys");
      let view = running;
      for (let i = 0; i < FollowView.SPINNER.length; i++) {
        view = FollowView.tick(view);
      }
      expect(FollowView.draw(view, 5)).toContain("\x1b[90m⠋ send-keys");
    }),
  );

  it.effect("shows the last rows - 2 entries and truncates long names with an ellipsis", () =>
    Effect.sync(() => {
      const events: Array<Domain.FollowEvent> = Array.from({ length: 5 }, (_, index) => ({
        type: "action",
        id: index,
        name: "get-image",
        state: "running",
      }));
      const long = "a".repeat(60);
      const view = applyAll([
        { type: "intent", state: "started", message: long },
        { type: "intent", state: "completed" },
        ...events,
      ]);
      const out = FollowView.draw(view, 5);
      expect(out).not.toContain(long);
      expect(out.match(/get-image/g)).toHaveLength(3);
      const wide = FollowView.draw(view, 24);
      expect(wide).toContain(`✓ ${"a".repeat(FollowView.LEFT_COLS - 3 - 1)}…\x1b[0m`);
    }),
  );

  it.effect("places the image at column 42, row 2 in the remaining columns, or not at all", () =>
    Effect.sync(() => {
      expect(FollowView.imageBox(100, 24)).toEqual(
        Option.some({ col: 42, row: 2, cols: 59, rows: 23 }),
      );
      expect(FollowView.imageBox(41, 24)).toEqual(Option.none());
      expect(FollowView.imageBox(42, 24)).toEqual(
        Option.some({ col: 42, row: 2, cols: 1, rows: 23 }),
      );
      const view = applyAll([{ type: "image", id: IMAGE_ID, png: TINY_PNG_BASE64 }]);
      const placed = FollowView.drawImage(view, 100, 24);
      expect(placed.startsWith("\x1b_Ga=d,d=I,i=1,q=2\x1b\\\x1b[2;42H\x1b_Ga=T")).toBe(true);
      expect(placed).toBe(
        Image.placeImage(new Uint8Array(TINY_PNG), { col: 42, row: 2, cols: 59, rows: 23 }),
      );
      expect(FollowView.drawImage(view, 41, 24)).toBe("");
      expect(FollowView.drawImage(FollowView.initialView(FOLLOWED_ID), 100, 24)).toBe("");
    }),
  );
});

describe("follow view runner", () => {
  const encode = Domain.encodeFollowLine;

  it.effect(
    "takes the alternate screen on the first event, spins every 80 ms, redraws on resize and restores on end",
    () =>
      Effect.gen(function* () {
        const tty = fakeTty({ columns: 100, rows: 24 });
        const queue = yield* Queue.unbounded<string, Cause.Done>();
        const fiber = yield* Effect.forkChild(
          FollowView.run(FOLLOWED_ID, Stream.fromQueue(queue), tty.output),
          { startImmediately: true },
        );
        yield* settle;
        expect(tty.written()).toBe("");
        yield* Queue.offer(queue, encode({ type: "session", status: "running" }).trimEnd());
        yield* settle;
        const afterFirst = tty.written();
        expect(afterFirst.startsWith(FollowView.ENTER_SCREEN)).toBe(true);
        expect(afterFirst).toContain("following 7a2d0000 \x1b[33mrunning");
        yield* Queue.offer(
          queue,
          encode({ type: "intent", state: "started", message: "wait for the boot menu" }).trimEnd(),
        );
        yield* settle;
        expect(tty.written()).toContain("\x1b[90m⠋ wait for the boot menu");
        yield* TestClock.adjust("80 millis");
        yield* settle;
        expect(tty.written()).toContain("\x1b[90m⠙ wait for the boot menu");
        yield* TestClock.adjust("80 millis");
        yield* settle;
        expect(tty.written()).toContain("\x1b[90m⠹ wait for the boot menu");
        yield* Queue.offer(
          queue,
          encode({ type: "image", id: IMAGE_ID, png: TINY_PNG_BASE64 }).trimEnd(),
        );
        yield* settle;
        expect(tty.written()).toContain(
          `\x1b_Ga=d,d=I,i=1,q=2\x1b\\\x1b[2;42H\x1b_Ga=T,f=100,i=1,q=2,C=1,c=46,r=23,m=0;${TINY_PNG_BASE64}\x1b\\`,
        );
        const beforeResize = tty.written().length;
        tty.output.emit("resize");
        yield* settle;
        const resized = tty.written().slice(beforeResize);
        expect(resized.startsWith(`\x1b[2J${Image.clearImages}\x1b[1;2H`)).toBe(true);
        expect(resized).toContain("\x1b[2;42H\x1b_Ga=T");
        yield* Queue.offer(queue, encode({ type: "session", status: "succeeded" }).trimEnd());
        yield* Queue.end(queue);
        const view = yield* Fiber.join(fiber);
        expect(view.status).toBe("succeeded");
        const out = tty.written();
        expect(out.endsWith(`${Image.clearImages}${FollowView.LEAVE_SCREEN}`)).toBe(true);
        expect(
          out.slice(FollowView.ENTER_SCREEN.length, -FollowView.LEAVE_SCREEN.length),
        ).not.toMatch(/\n/);
        // The spinner stopped with the screen.
        const settled = tty.written().length;
        yield* TestClock.adjust("160 millis");
        yield* settle;
        expect(tty.written().length).toBe(settled);
        expect(tty.output.listenerCount("resize")).toBe(0);
      }),
  );

  it.effect("never touches the screen when the stream ends without an event", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const view = yield* FollowView.run(FOLLOWED_ID, Stream.empty, tty.output);
      expect(view.status).toBe("pending");
      expect(tty.written()).toBe("");
    }),
  );

  it.effect("restores the screen when interrupted mid-stream", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const queue = yield* Queue.unbounded<string, Cause.Done>();
      const fiber = yield* Effect.forkChild(
        FollowView.run(FOLLOWED_ID, Stream.fromQueue(queue), tty.output),
        { startImmediately: true },
      );
      yield* Queue.offer(queue, encode({ type: "session", status: "running" }).trimEnd());
      yield* settle;
      expect(tty.written()).toContain(FollowView.ENTER_SCREEN);
      yield* Fiber.interrupt(fiber);
      expect(tty.written().endsWith(`${Image.clearImages}${FollowView.LEAVE_SCREEN}`)).toBe(true);
    }),
  );

  it.effect("a line that is not a follow event is a defect, not a silent skip", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const exit = yield* Effect.exit(
        FollowView.run(FOLLOWED_ID, Stream.make("not json"), tty.output),
      );
      expect(exit._tag).toBe("Failure");
    }),
  );
});
