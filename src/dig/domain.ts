import { Schema } from "effect";

export const SLOT_COUNT = 4;
export const PLAYER_DAMAGE = 1;
export const PERFECT_MULTIPLIER = 1.25;
export const DIRT_HP = 2;
export const PERFECT_WINDOW_MS = 50;
export const OKAY_WINDOW_MS = 100;
export const MUSIC_LEAD_MS = 3_000;
export const BEAT_MS = 500;
export const NOTE_COUNT = 32;
export const GHOST_OPACITY = 0.5;

export const Direction = Schema.Literals(["w", "a", "s", "d"]).annotate({
  identifier: "@oligarchy/dig/domain/Direction",
});
export type Direction = typeof Direction.Type;
export const DIRECTIONS: ReadonlyArray<Direction> = Direction.literals;

export const Judgment = Schema.Literals(["perfect", "okay", "miss"]).annotate({
  identifier: "@oligarchy/dig/domain/Judgment",
});
export type Judgment = typeof Judgment.Type;

export const Phase = Schema.Literals(["lobby", "playing"]).annotate({
  identifier: "@oligarchy/dig/domain/Phase",
});
export type Phase = typeof Phase.Type;

export type Note = {
  readonly id: number;
  readonly direction: Direction;
  readonly hitMs: number;
};

export type Judged = {
  readonly noteId: number;
  readonly judgment: Judgment;
};

export type Player = {
  readonly id: string;
  readonly slot: number;
  readonly ready: boolean;
  readonly totalDamage: number;
  readonly judged: ReadonlyArray<Judged>;
};
