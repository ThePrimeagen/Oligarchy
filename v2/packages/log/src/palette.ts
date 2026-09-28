import * as Render from "./render.ts";

// A ticket seen within the last hour is active; the trim that drops the rest runs at most once
// an hour, so a colour stays with its ticket for at least that long after its last line.
export const IDLE_MS = 3_600_000;

type Held = { readonly color: string; readonly seenAt: number };

// Which colour each agent took and when it last logged, where the round robin stands, and
// when idle agents were last dropped.
export type Palette = {
  readonly agents: ReadonlyMap<string, Held>;
  readonly next: number;
  readonly trimmedAt: number;
};

export const empty: Palette = { agents: new Map(), next: 0, trimmedAt: 0 };

const trim = (palette: Palette, now: number): Palette => ({
  ...palette,
  agents: new Map([...palette.agents].filter(([, held]) => now - held.seenAt < IDLE_MS)),
  trimmedAt: now,
});

// An agent's line: it keeps the colour it has, or takes the next one in turn that no active
// agent holds (the next in turn when every one is held), and counts as seen now.
export const touch = (
  palette: Palette,
  agentId: string,
  now: number,
): { readonly palette: Palette; readonly color: string } => {
  const current = now - palette.trimmedAt >= IDLE_MS ? trim(palette, now) : palette;
  const agents = new Map(current.agents);
  const known = agents.get(agentId);
  if (known !== undefined) {
    agents.set(agentId, { color: known.color, seenAt: now });
    return { palette: { ...current, agents }, color: known.color };
  }
  const taken = new Set([...agents.values()].map((held) => held.color));
  const count = Render.AGENT_COLORS.length;
  // A colour's place in the queue: its turn after `next`, and behind every free one if held.
  const pick = Render.AGENT_COLORS.map((color, index) => ({
    color,
    index,
    rank: (taken.has(color) ? count : 0) + ((index - current.next + count) % count),
  })).reduce((best, candidate) => (candidate.rank < best.rank ? candidate : best));
  agents.set(agentId, { color: pick.color, seenAt: now });
  return { palette: { ...current, agents, next: (pick.index + 1) % count }, color: pick.color };
};

export const colorOf = (palette: Palette, agentId: string): string | undefined =>
  palette.agents.get(agentId)?.color;
