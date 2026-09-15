import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Domain from "../../src/dig/domain.ts";
import * as Lobby from "../../src/dig/lobby.ts";
import * as Room from "../../src/dig/room.ts";

const seatedReady = (id: string): Room.Room => {
  const joined = Lobby.join(Room.empty(), id);
  if (Result.isFailure(joined)) {
    throw new Error("join");
  }
  const readied = Lobby.ready(joined.success, id);
  if (Result.isFailure(readied)) {
    throw new Error("ready");
  }
  return readied.success;
};

const playing = (): Room.Room => {
  const started = Lobby.start(seatedReady("p1"), "p1", 0, 1);
  if (Result.isFailure(started)) {
    throw new Error("start");
  }
  return started.success;
};

describe("playing hits happy path", () => {
  it("judges a perfect on the first note and digs 125%", () => {
    const room = playing();
    const note = room.notes[0];
    expect(note).toBeDefined();
    if (note === undefined) {
      return;
    }
    const hit = Room.hit(room, "p1", note.id, note.direction, note.hitMs);
    expect(Result.isSuccess(hit)).toBe(true);
    if (Result.isFailure(hit)) {
      return;
    }
    expect(hit.success.judgment).toBe("perfect");
    expect(hit.success.damage).toBe(1.25);
    expect(hit.success.room.players[0]?.totalDamage).toBe(1.25);
    expect(hit.success.room.players[0]?.judged).toEqual([{ noteId: note.id, judgment: "perfect" }]);
  });

  it("keeps other players' depth on the snapshot so they can render as ghosts", () => {
    const first = Lobby.join(Room.empty(), "p1");
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const second = Lobby.join(first.success, "p2");
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isFailure(second)) {
      return;
    }
    const ready1 = Lobby.ready(second.success, "p1");
    expect(Result.isSuccess(ready1)).toBe(true);
    if (Result.isFailure(ready1)) {
      return;
    }
    const ready2 = Lobby.ready(ready1.success, "p2");
    expect(Result.isSuccess(ready2)).toBe(true);
    if (Result.isFailure(ready2)) {
      return;
    }
    const started = Lobby.start(ready2.success, "p1", 0, 1);
    expect(Result.isSuccess(started)).toBe(true);
    if (Result.isFailure(started)) {
      return;
    }
    const note = started.success.notes[0];
    expect(note).toBeDefined();
    if (note === undefined) {
      return;
    }
    const hit = Room.hit(started.success, "p1", note.id, note.direction, note.hitMs);
    expect(Result.isSuccess(hit)).toBe(true);
    if (Result.isFailure(hit)) {
      return;
    }
    const snap = Room.snapshot(hit.success.room, "p2", 3_000);
    expect(snap.you).toBe("p2");
    expect(snap.players).toHaveLength(2);
    const self = snap.players.find((player) => player.id === "p2");
    const other = snap.players.find((player) => player.id === "p1");
    expect(self?.ghost).toBe(false);
    expect(other?.ghost).toBe(true);
    expect(other?.depth).toBe(1.25 / Domain.DIRT_HP);
    expect(self?.depth).toBe(0);
    expect(snap.ghostOpacity).toBe(Domain.GHOST_OPACITY);
  });
});

describe("playing hits unhappy path", () => {
  it("refuses a hit before the captain has started the game", () => {
    const refused = Room.hit(seatedReady("p1"), "p1", 1, "w", 0);
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isSuccess(refused)) {
      return;
    }
    expect(refused.failure._tag).toBe("NotPlaying");
  });

  it("expires a skipped note as a miss that still deals 100% damage", () => {
    const room = playing();
    const note = room.notes[0];
    expect(note).toBeDefined();
    if (note === undefined) {
      return;
    }
    const late = note.hitMs + Domain.OKAY_WINDOW_MS + 1;
    const ticked = Room.tick(room, "p1", late);
    expect(Result.isSuccess(ticked)).toBe(true);
    if (Result.isFailure(ticked)) {
      return;
    }
    const judged = ticked.success.players[0]?.judged[0];
    expect(judged).toEqual({ noteId: note.id, judgment: "miss" });
    expect(ticked.success.players[0]?.totalDamage).toBe(1);
  });

  it("refuses judging the same note twice", () => {
    const room = playing();
    const note = room.notes[0];
    expect(note).toBeDefined();
    if (note === undefined) {
      return;
    }
    const first = Room.hit(room, "p1", note.id, note.direction, note.hitMs);
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const again = Room.hit(first.success.room, "p1", note.id, note.direction, note.hitMs);
    expect(Result.isFailure(again)).toBe(true);
    if (Result.isSuccess(again)) {
      return;
    }
    expect(again.failure._tag).toBe("AlreadyJudged");
  });
});
