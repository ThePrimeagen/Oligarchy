import * as Render from "./render.ts";

// A job seen within the last hour is active; the trim that drops the rest runs at most once
// an hour, so a colour stays with its job for at least that long after its last line.
export const IDLE_MS = 3_600_000;

type Held = { readonly color: string; readonly seenAt: number };

// Which colour each job took and when it last logged, where the round robin stands, and
// when idle jobs were last dropped.
export type Palette = {
  readonly jobs: ReadonlyMap<string, Held>;
  readonly next: number;
  readonly trimmedAt: number;
};

export const empty: Palette = { jobs: new Map(), next: 0, trimmedAt: 0 };

const trim = (palette: Palette, now: number): Palette => ({
  ...palette,
  jobs: new Map([...palette.jobs].filter(([, held]) => now - held.seenAt < IDLE_MS)),
  trimmedAt: now,
});

// A job's line: it keeps the colour it has, or takes the next one in turn that no active
// job holds (the next in turn when every one is held), and counts as seen now.
export const touch = (
  palette: Palette,
  jobId: string,
  now: number,
): { readonly palette: Palette; readonly color: string } => {
  const current = now - palette.trimmedAt >= IDLE_MS ? trim(palette, now) : palette;
  const jobs = new Map(current.jobs);
  const known = jobs.get(jobId);
  if (known !== undefined) {
    jobs.set(jobId, { color: known.color, seenAt: now });
    return { palette: { ...current, jobs }, color: known.color };
  }
  const taken = new Set([...jobs.values()].map((held) => held.color));
  const count = Render.JOB_COLORS.length;
  // A colour's place in the queue: its turn after `next`, and behind every free one if held.
  const pick = Render.JOB_COLORS.map((color, index) => ({
    color,
    index,
    rank: (taken.has(color) ? count : 0) + ((index - current.next + count) % count),
  })).reduce((best, candidate) => (candidate.rank < best.rank ? candidate : best));
  jobs.set(jobId, { color: pick.color, seenAt: now });
  return { palette: { ...current, jobs, next: (pick.index + 1) % count }, color: pick.color };
};
