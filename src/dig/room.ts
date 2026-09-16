import { Result } from "effect";
import * as Combat from "./combat.ts";
import * as Domain from "./domain.ts";
import * as Errors from "./errors.ts";
import * as Lobby from "./lobby.ts";
import * as Timing from "./timing.ts";

export const SLOT_COUNT = Domain.SLOT_COUNT;

export type Room = {
  readonly players: ReadonlyArray<Domain.Player>;
  readonly phase: Domain.Phase;
  readonly startedAtMs: number;
  readonly notes: ReadonlyArray<Domain.Note>;
};

export type Seat = {
  readonly id: string;
  readonly slot: number;
  readonly ready: boolean;
  readonly captain: boolean;
  readonly depth: number;
  readonly totalDamage: number;
  readonly ghost: boolean;
  readonly judged: ReadonlyArray<Domain.Judged>;
};

export type Snapshot = {
  readonly _tag: "Snapshot";
  readonly you: string;
  readonly youAreCaptain: boolean;
  readonly captainId: string;
  readonly phase: Domain.Phase;
  readonly startedAtMs: number;
  readonly serverNowMs: number;
  readonly readyLabel: string;
  readonly ghostOpacity: number;
  readonly notes: ReadonlyArray<Domain.Note>;
  readonly players: ReadonlyArray<Seat>;
};

export type Hit = {
  readonly room: Room;
  readonly judgment: Domain.Judgment;
  readonly damage: number;
  readonly depth: number;
};

export const empty = (): Room => ({
  players: [],
  phase: "lobby",
  startedAtMs: 0,
  notes: [],
});

const playerOf = (room: Room, playerId: string): Domain.Player | undefined =>
  room.players.find((player) => player.id === playerId);

const replace = (room: Room, player: Domain.Player): Room => ({
  ...room,
  players: room.players.map((seat) => (seat.id === player.id ? player : seat)),
});

const judgedNote = (player: Domain.Player, noteId: number): boolean =>
  player.judged.some((hit) => hit.noteId === noteId);

const expire = (
  player: Domain.Player,
  notes: ReadonlyArray<Domain.Note>,
  songTimeMs: number,
): Domain.Player => {
  let next = player;
  for (const note of notes) {
    if (judgedNote(next, note.id)) {
      continue;
    }
    if (songTimeMs <= note.hitMs + Domain.OKAY_WINDOW_MS) {
      continue;
    }
    next = {
      ...next,
      judged: [...next.judged, { noteId: note.id, judgment: "miss" }],
      totalDamage: Combat.applyDamage(next.totalDamage, "miss"),
    };
  }
  return next;
};

export const snapshot = (room: Room, you: string, serverNowMs: number): Snapshot => {
  const captain = Lobby.captainId(room);
  return {
    _tag: "Snapshot",
    you,
    youAreCaptain: captain === you,
    captainId: captain,
    phase: room.phase,
    startedAtMs: room.startedAtMs,
    serverNowMs,
    readyLabel: Lobby.readyLabel(room),
    ghostOpacity: Domain.GHOST_OPACITY,
    notes: room.notes,
    players: room.players.map((player) => ({
      id: player.id,
      slot: player.slot,
      ready: player.ready,
      captain: player.id === captain,
      depth: Combat.depth(player.totalDamage),
      totalDamage: player.totalDamage,
      ghost: player.id !== you,
      judged: player.judged,
    })),
  };
};

export const tick = (
  room: Room,
  playerId: string,
  songTimeMs: number,
): Result.Result<Room, Errors.UnknownPlayer> => {
  const player = playerOf(room, playerId);
  if (player === undefined) {
    return Result.fail(Errors.UnknownPlayer.make({ message: `unknown player "${playerId}"` }));
  }
  if (room.phase !== "playing") {
    return Result.succeed(room);
  }
  return Result.succeed(replace(room, expire(player, room.notes, songTimeMs)));
};

export const hit = (
  room: Room,
  playerId: string,
  noteId: number,
  direction: Domain.Direction,
  songTimeMs: number,
): Result.Result<
  Hit,
  Errors.UnknownPlayer | Errors.NotPlaying | Errors.UnknownNote | Errors.AlreadyJudged
> => {
  if (room.phase !== "playing") {
    return Result.fail(Errors.NotPlaying.make({}));
  }
  const player = playerOf(room, playerId);
  if (player === undefined) {
    return Result.fail(Errors.UnknownPlayer.make({ message: `unknown player "${playerId}"` }));
  }
  const note = room.notes.find((item) => item.id === noteId);
  if (note === undefined) {
    return Result.fail(Errors.UnknownNote.make({ message: `unknown note ${String(noteId)}` }));
  }
  const current = expire(player, room.notes, songTimeMs);
  if (judgedNote(current, noteId)) {
    return Result.fail(Errors.AlreadyJudged.make({}));
  }
  const judgment = Timing.judge(songTimeMs - note.hitMs, note.direction, direction);
  const next: Domain.Player = {
    ...current,
    judged: [...current.judged, { noteId, judgment }],
    totalDamage: Combat.applyDamage(current.totalDamage, judgment),
  };
  return Result.succeed({
    room: replace(room, next),
    judgment,
    damage: Combat.damageFor(judgment),
    depth: Combat.depth(next.totalDamage),
  });
};
