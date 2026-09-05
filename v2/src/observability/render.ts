import { WriteStream } from "node:tty";
import { styleText } from "node:util";
import { Cause, Console, Effect, Option, Schema } from "effect";
import { CliError } from "effect/unstable/cli";
import * as ExternalFailure from "../external-failure.ts";
import type * as Domain from "../shared/domain.ts";

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

const errorInstance = Schema.decodeUnknownOption(Schema.ErrorInstance());
const messageField = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

const messageOf = (value: unknown): string | undefined => {
  const error = errorInstance(value);
  if (Option.isSome(error)) {
    return error.value.message;
  }
  return Option.getOrUndefined(Option.map(messageField(value), (found) => found.message));
};

export const errorDetail = (cause: unknown): string => messageOf(cause) ?? String(cause);

// `message` alone, or `message: cause.message` when the error carries a cause with a message.
export const headline = (error: unknown): string => {
  const message = errorDetail(error);
  const cause = ExternalFailure.causeOf(error);
  if (cause === error) {
    return message;
  }
  const detail = messageOf(cause);
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

const ROSE_PINE_MAIN = {
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

export const paint = (hex: string, text: string, colors: boolean): string => {
  if (!colors) {
    return text;
  }
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `\x1b[38;2;${String(r)};${String(g)};${String(b)}m${text}\x1b[39m`;
};

const style = (format: "gray" | "white", text: string, colors: boolean): string =>
  colors ? styleText(format, text, { validateStream: false }) : text;

export type LogLine = {
  readonly text: string;
  readonly level: Domain.LogLevel;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly color?: string;
};

export const renderLogLine = (entry: LogLine, colors: boolean): string => {
  const tag = entry.agentId ?? "global";
  const text = entry.level === "info" ? entry.text : `${entry.level}: ${entry.text}`;
  const ticket =
    entry.color === undefined ? style("gray", tag, colors) : paint(entry.color, tag, colors);
  const rest =
    entry.sessionId === undefined
      ? style("white", `] ${text}`, colors)
      : `${style("white", "] ", colors)}${style("gray", entry.sessionId, colors)}${style("white", `: ${text}`, colors)}`;
  return `${style("white", "[", colors)}${ticket}${rest}`;
};

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
  // 16, not 24-bit: tmux and FORCE_COLOR=1 report 256/16 and still render 38;2.
  return stream.hasColors === undefined
    ? WriteStream.prototype.hasColors.call(stream, 16, env)
    : stream.hasColors(16, env);
};

// Decided once for the process; the Log service reads it through `Log.Colors`.
export const stdoutColors: boolean = wantsColor(process.stdout, process.env);
