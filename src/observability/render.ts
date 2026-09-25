import { WriteStream } from "node:tty";
import { Cause, Console, Effect, Option } from "effect";
import * as CliError from "effect/unstable/cli/CliError";
import * as ExternalFailure from "../external-failure.ts";
import type * as Domain from "../shared/domain.ts";

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export const errorDetail = (cause: unknown): string =>
  ExternalFailure.messageOf(cause) ?? String(cause);

// `message` alone, or `message: cause.message` when the error carries a cause with a message.
export const headline = (error: unknown): string => {
  const message = errorDetail(error);
  const cause = ExternalFailure.causeOf(error);
  if (cause === error) {
    return message;
  }
  const detail = ExternalFailure.messageOf(cause);
  return detail === undefined ? message : `${message}: ${detail}`;
};

export const renderFailure = <E>(cause: Cause.Cause<E>): string =>
  Cause.hasInterruptsOnly(cause) ? "" : `${headline(Cause.squash(cause))}\n${Cause.pretty(cause)}`;

// ---------------------------------------------------------------------------
// Log lines
// The process boundary's one print: Effect has already rendered help and usage errors, so a
// CliError says nothing more; an interrupt says nothing; everything else is one headline, then
// the cause. It needs no services, so it sits outside the layers and also covers their failures.
export const reportFailure = <E>(cause: Cause.Cause<E>): Effect.Effect<void> => {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure) && CliError.isCliError(failure.value)) {
    return Effect.void;
  }
  const text = renderFailure(cause);
  return text === "" ? Effect.void : Console.error(text);
};

// ---------------------------------------------------------------------------

// The one palette every terminal of ours is painted in: the log's agent colours and the viz.
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
export const foreground = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `\x1b[38;2;${String(r)};${String(g)};${String(b)}m`;
};

export const paint = (hex: string, text: string, colors: boolean): string =>
  colors ? `${foreground(hex)}${text}\x1b[39m` : text;

export type LogLine = {
  readonly text: string;
  readonly level: Domain.LogLevel;
  readonly location?: string;
  readonly agentId?: string;
  readonly color?: string;
};

// The bracketed label a line opens with, and the colour of the label and of the words after it:
// an error's words are as red as its label, a warning keeps its words white.
const LEVELS: Readonly<
  Record<Domain.LogLevel, { readonly label: string; readonly color: string; readonly text: string }>
> = {
  info: { label: "[INFO]", color: ROSE_PINE_MAIN.text, text: ROSE_PINE_MAIN.text },
  warning: { label: "[WARN]", color: ROSE_PINE_MAIN.gold, text: ROSE_PINE_MAIN.text },
  error: { label: "[ERROR]", color: ROSE_PINE_MAIN.love, text: ROSE_PINE_MAIN.love },
  fatal: { label: "[FATAL]", color: ROSE_PINE_MAIN.love, text: ROSE_PINE_MAIN.love },
};

// One line as coloured runs: stdout paints them, the viz's log pane draws them as they are.
// A ticket without a colour of its own is muted, like the location.
export const logPieces = (
  entry: LogLine,
): ReadonlyArray<{ readonly text: string; readonly color: string }> => {
  const level = LEVELS[entry.level];
  return [
    { text: level.label, color: level.color },
    { text: " [", color: ROSE_PINE_MAIN.text },
    { text: entry.agentId ?? "global", color: entry.color ?? ROSE_PINE_MAIN.muted },
    { text: "] ", color: ROSE_PINE_MAIN.text },
    ...(entry.location === undefined
      ? []
      : [
          { text: entry.location, color: ROSE_PINE_MAIN.muted },
          { text: ": ", color: ROSE_PINE_MAIN.text },
        ]),
    { text: entry.text, color: level.text },
  ];
};

export const renderLogLine = (entry: LogLine, colors: boolean): string =>
  logPieces(entry)
    .map((piece) => paint(piece.color, piece.text, colors))
    .join("");

export type ColorStream = {
  readonly isTTY?: boolean | undefined;
  readonly hasColors?: ((count: number, env?: object) => boolean) | undefined;
};

export const wantsColor = (
  stream: ColorStream,
  env: { readonly FORCE_COLOR?: string | undefined },
): boolean => {
  if (stream.isTTY !== true && env.FORCE_COLOR === undefined) {
    return false;
  }
  // 16 colours, not 24-bit: tmux and FORCE_COLOR=1 report 256/16 and still render 38;2. A piped
  // stdout has no hasColors, so the runtime's depth is asked directly (16 colours is 4 bits);
  // Bun's hasColors would reach for this.getColorDepth on whatever it is called on.
  return stream.hasColors === undefined
    ? WriteStream.prototype.getColorDepth.call(stream, env) >= 4
    : stream.hasColors(16, env);
};

// Decided once for the process; the Log service reads it through `Log.Colors`.
export const stdoutColors: boolean = wantsColor(process.stdout, process.env);
