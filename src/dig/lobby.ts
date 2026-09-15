import { Result } from "effect";
import * as Chart from "./chart.ts";
import type * as Domain from "./domain.ts";
import * as Errors from "./errors.ts";
import * as Room from "./room.ts";

const seated = (room: Room.Room, playerId: string): Domain.Player | undefined =>
  room.players.find((player) => player.id === playerId);

const freeSlot = (room: Room.Room): number => {
  const used = new Set(room.players.map((player) => player.slot));
  for (let slot = 0; slot < Room.SLOT_COUNT; slot++) {
    if (!used.has(slot)) {
      return slot;
    }
  }
  return Room.SLOT_COUNT;
};

export const captainId = (room: Room.Room): string => room.players[0]?.id ?? "";

export const readyLabel = (room: Room.Room): string => {
  const ready = room.players.filter((player) => player.ready).length;
  return `${String(ready)} / ${String(room.players.length)} players ready`;
};

export const join = (
  room: Room.Room,
  playerId: string,
): Result.Result<Room.Room, Errors.RoomFull> => {
  if (seated(room, playerId) !== undefined) {
    return Result.succeed(room);
  }
  if (room.phase !== "lobby" || room.players.length >= Room.SLOT_COUNT) {
    return Result.fail(Errors.RoomFull.make({}));
  }
  const slot = freeSlot(room);
  const player: Domain.Player = {
    id: playerId,
    slot,
    ready: false,
    totalDamage: 0,
    judged: [],
  };
  return Result.succeed({ ...room, players: [...room.players, player] });
};

export const leave = (room: Room.Room, playerId: string): Room.Room => ({
  ...room,
  players: room.players.filter((player) => player.id !== playerId),
});

export const ready = (
  room: Room.Room,
  playerId: string,
): Result.Result<Room.Room, Errors.UnknownPlayer | Errors.AlreadyStarted> => {
  if (room.phase !== "lobby") {
    return Result.fail(Errors.AlreadyStarted.make({}));
  }
  if (seated(room, playerId) === undefined) {
    return Result.fail(Errors.UnknownPlayer.make({ message: `unknown player "${playerId}"` }));
  }
  return Result.succeed({
    ...room,
    players: room.players.map((player) =>
      player.id === playerId ? { ...player, ready: true } : player,
    ),
  });
};

export const start = (
  room: Room.Room,
  playerId: string,
  nowMs: number,
  seed: number,
): Result.Result<
  Room.Room,
  Errors.UnknownPlayer | Errors.NotCaptain | Errors.NotReady | Errors.AlreadyStarted
> => {
  if (room.phase !== "lobby") {
    return Result.fail(Errors.AlreadyStarted.make({}));
  }
  if (seated(room, playerId) === undefined) {
    return Result.fail(Errors.UnknownPlayer.make({ message: `unknown player "${playerId}"` }));
  }
  if (captainId(room) !== playerId) {
    return Result.fail(Errors.NotCaptain.make({}));
  }
  if (room.players.length === 0 || room.players.some((player) => !player.ready)) {
    return Result.fail(Errors.NotReady.make({}));
  }
  return Result.succeed({
    ...room,
    phase: "playing",
    startedAtMs: nowMs,
    notes: Chart.make(seed),
  });
};
