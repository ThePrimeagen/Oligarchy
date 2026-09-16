import * as Domain from "./domain.ts";

const scramble = (seed: number): number => (Math.imul(seed, 1_664_525) + 1_013_904_223) | 0;

export const make = (seed: number): ReadonlyArray<Domain.Note> => {
  const notes: Array<Domain.Note> = [];
  let rng = scramble(seed === 0 ? 1 : seed);
  for (let i = 0; i < Domain.NOTE_COUNT; i++) {
    rng = scramble(rng);
    const index = rng < 0 ? -rng : rng;
    const direction = Domain.DIRECTIONS[index % Domain.DIRECTIONS.length];
    if (direction === undefined) {
      throw new Error("chart direction");
    }
    notes.push({
      id: i + 1,
      direction,
      hitMs: Domain.MUSIC_LEAD_MS + i * Domain.BEAT_MS,
    });
  }
  return notes;
};
