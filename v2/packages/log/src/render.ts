import type * as Log from "./main.ts";

export const ROSE_PINE_MAIN = {
  love: "#eb6f92",
  gold: "#f6c177",
  rose: "#ebbcba",
  pine: "#31748f",
  foam: "#9ccfd8",
  iris: "#c4a7e7",
  leaf: "#95b1ac",
  text: "#e0def4",
  subtle: "#908caa",
  muted: "#6e6a86",
} as const;

export const AGENT_COLORS: ReadonlyArray<string> = Object.values(ROSE_PINE_MAIN);

// The 24-bit foreground sequence for a `#rrggbb` colour; `\x1b[39m` puts the default back.
const foreground = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${String((n >> 16) & 255)};${String((n >> 8) & 255)};${String(n & 255)}m`;
};

const paint = (hex: string, text: string, colors: boolean): string =>
  colors ? `${foreground(hex)}${text}\x1b[39m` : text;

export type Line = {
  readonly text: string;
  readonly level: Log.Level;
  readonly location?: string;
  readonly agentId?: string;
  readonly color?: string;
};

// An error's words are as red as its label; a warning keeps its words white.
const LEVELS: Readonly<
  Record<Log.Level, { readonly label: string; readonly color: string; readonly text: string }>
> = {
  info: { label: "[INFO]", color: ROSE_PINE_MAIN.text, text: ROSE_PINE_MAIN.text },
  warning: { label: "[WARN]", color: ROSE_PINE_MAIN.gold, text: ROSE_PINE_MAIN.text },
  error: { label: "[ERROR]", color: ROSE_PINE_MAIN.love, text: ROSE_PINE_MAIN.love },
  fatal: { label: "[FATAL]", color: ROSE_PINE_MAIN.love, text: ROSE_PINE_MAIN.love },
};

export const renderLine = (line: Line, colors: boolean): string => {
  const level = LEVELS[line.level];
  const pieces: ReadonlyArray<readonly [string, string]> = [
    [level.label, level.color],
    [" [", ROSE_PINE_MAIN.text],
    [line.agentId ?? "global", line.color ?? ROSE_PINE_MAIN.muted],
    ["] ", ROSE_PINE_MAIN.text],
    ...(line.location === undefined
      ? []
      : ([
          [line.location, ROSE_PINE_MAIN.muted],
          [": ", ROSE_PINE_MAIN.text],
        ] as const)),
    [line.text, level.text],
  ];
  return pieces.map(([text, color]) => paint(color, text, colors)).join("");
};
