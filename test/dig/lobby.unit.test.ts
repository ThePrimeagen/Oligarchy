import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Domain from "../../src/dig/domain.ts";
import * as Lobby from "../../src/dig/lobby.ts";
import * as Room from "../../src/dig/room.ts";

const open = (): Room.Room => Room.empty();

describe("lobby join happy path", () => {
  it("seats the first player in slot 0, not ready, as captain", () => {
    const joined = Lobby.join(open(), "p1");
    expect(Result.isSuccess(joined)).toBe(true);
    if (Result.isFailure(joined)) {
      return;
    }
    expect(Lobby.readyLabel(joined.success)).toBe("0 / 1 players ready");
    expect(Lobby.captainId(joined.success)).toBe("p1");
    expect(joined.success.players).toEqual([
      {
        id: "p1",
        slot: 0,
        ready: false,
        totalDamage: 0,
        judged: [],
      },
    ]);
  });

  it("fills the next free slot and recounts ready as players join", () => {
    const first = Lobby.join(open(), "p1");
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const readied = Lobby.ready(first.success, "p1");
    expect(Result.isSuccess(readied)).toBe(true);
    if (Result.isFailure(readied)) {
      return;
    }
    const second = Lobby.join(readied.success, "p2");
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isFailure(second)) {
      return;
    }
    expect(Lobby.readyLabel(second.success)).toBe("1 / 2 players ready");
    expect(second.success.players.map((player) => player.slot)).toEqual([0, 1]);
    expect(Lobby.captainId(second.success)).toBe("p1");
  });

  it("reuses a freed slot so a later join still lands in one of four spots", () => {
    let room = open();
    for (const id of ["a", "b", "c"]) {
      const joined = Lobby.join(room, id);
      expect(Result.isSuccess(joined)).toBe(true);
      if (Result.isFailure(joined)) {
        return;
      }
      room = joined.success;
    }
    room = Lobby.leave(room, "b");
    const again = Lobby.join(room, "d");
    expect(Result.isSuccess(again)).toBe(true);
    if (Result.isFailure(again)) {
      return;
    }
    expect(again.success.players.map((player) => [player.id, player.slot])).toEqual([
      ["a", 0],
      ["c", 2],
      ["d", 1],
    ]);
  });
});

describe("lobby join unhappy path", () => {
  it("kicks a fifth player with the room is full", () => {
    let room = open();
    for (const id of ["a", "b", "c", "d"]) {
      const joined = Lobby.join(room, id);
      expect(Result.isSuccess(joined)).toBe(true);
      if (Result.isFailure(joined)) {
        return;
      }
      room = joined.success;
    }
    const fifth = Lobby.join(room, "e");
    expect(Result.isFailure(fifth)).toBe(true);
    if (Result.isSuccess(fifth)) {
      return;
    }
    expect(fifth.failure._tag).toBe("RoomFull");
    expect(fifth.failure.message).toBe("the room is full");
    expect(room.players).toHaveLength(Domain.SLOT_COUNT);
  });

  it("refuses ready from a player who is not seated", () => {
    const joined = Lobby.join(open(), "p1");
    expect(Result.isSuccess(joined)).toBe(true);
    if (Result.isFailure(joined)) {
      return;
    }
    const refused = Lobby.ready(joined.success, "nope");
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isSuccess(refused)) {
      return;
    }
    expect(refused.failure._tag).toBe("UnknownPlayer");
  });
});

describe("lobby captain happy path", () => {
  it("lets the first seated player start once everyone is ready", () => {
    const first = Lobby.join(open(), "p1");
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const readied = Lobby.ready(first.success, "p1");
    expect(Result.isSuccess(readied)).toBe(true);
    if (Result.isFailure(readied)) {
      return;
    }
    const started = Lobby.start(readied.success, "p1", 10_000, 1);
    expect(Result.isSuccess(started)).toBe(true);
    if (Result.isFailure(started)) {
      return;
    }
    expect(started.success.phase).toBe("playing");
    expect(started.success.startedAtMs).toBe(10_000);
    expect(started.success.notes.length).toBeGreaterThan(0);
    expect(started.success.notes[0]?.hitMs).toBe(Domain.MUSIC_LEAD_MS);
  });

  it("promotes the next seated player when the captain leaves", () => {
    const first = Lobby.join(open(), "p1");
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const second = Lobby.join(first.success, "p2");
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isFailure(second)) {
      return;
    }
    const left = Lobby.leave(second.success, "p1");
    expect(Lobby.captainId(left)).toBe("p2");
  });
});

describe("lobby captain unhappy path", () => {
  it("refuses start from anyone who is not the first player", () => {
    const first = Lobby.join(open(), "p1");
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const second = Lobby.join(first.success, "p2");
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isFailure(second)) {
      return;
    }
    const readied = Lobby.ready(second.success, "p2");
    expect(Result.isSuccess(readied)).toBe(true);
    if (Result.isFailure(readied)) {
      return;
    }
    const refused = Lobby.start(readied.success, "p2", 1, 1);
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isSuccess(refused)) {
      return;
    }
    expect(refused.failure._tag).toBe("NotCaptain");
  });

  it("refuses start while a seated player is not ready", () => {
    const first = Lobby.join(open(), "p1");
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isFailure(first)) {
      return;
    }
    const refused = Lobby.start(first.success, "p1", 1, 1);
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isSuccess(refused)) {
      return;
    }
    expect(refused.failure._tag).toBe("NotReady");
  });
});
