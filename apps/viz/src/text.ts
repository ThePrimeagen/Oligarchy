import * as Render from "@oligarchy/log/render";

// Rosé Pine, as the log's agent colours.
export const PALETTE = Render.ROSE_PINE_MAIN;

// Text with its colour, so a line of several colours can still be measured and cut; a piece
// without a colour is blank, drawn in whatever the row inherits.
export type Piece = {
  readonly text: string;
  readonly color?: string;
  readonly bold?: true;
};
export type Row = ReadonlyArray<Piece>;

export const paint = (color: string, text: string): Piece => ({ text, color });
export const muted = (text: string): Piece => paint(PALETTE.muted, text);
export const label = (text: string): Piece => paint(PALETTE.subtle, text);
export const value = (text: string): Piece => paint(PALETTE.text, text);
export const strong = (text: string): Piece => ({ text, color: PALETTE.text, bold: true });
export const SPACE: Piece = { text: " " };
export const GAP: Piece = { text: "  " };

// Text from the database (a test's name, a failure's message, an agent's intent) can span
// lines: a control character, C1 included (a UTF-8 terminal obeys U+009B as it does ESC [),
// would break the row or steer the terminal, so each is drawn as a space.
export const clean = (text: string): string =>
  Array.from(text, (character) =>
    character < " " || (character >= "\u007f" && character <= "\u009f") ? " " : character,
  ).join("");

// At most `width` columns, cut with an ellipsis.
export const cut = (text: string, width: number): string => {
  const plain = clean(text);
  return plain.length > width ? `${plain.slice(0, width - 1)}…` : plain;
};

// Exactly `width` columns: cut or padded, so a column is as wide as its neighbours.
export const fit = (text: string, width: number): string => cut(text, width).padEnd(width);

// The unit an operator reads at a glance: seconds under a minute, then whole minutes, hours,
// days. A stamp the database wrote just ahead of the read is 0, never negative.
export const age = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${String(seconds)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} h`;
  }
  return `${String(Math.floor(hours / 24))} d`;
};

// A running job's countup: seconds, then minutes and seconds ("10m 31s"), then hours and
// minutes ("1h 5m"). A stamp just ahead of the read is 0s.
export const count = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes)}m`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds)}s`;
  }
  return `${String(seconds)}s`;
};

// How long an action or the gap between two took: tenths of a second under a minute, where
// most of them fall, then the countup's minutes and seconds.
export const elapsed = (ms: number): string => {
  const clamped = Math.max(0, ms);
  return clamped < 60_000 ? `${(Math.floor(clamped / 100) / 10).toFixed(1)}s` : count(clamped);
};
