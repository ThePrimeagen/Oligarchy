import { Option, Result } from "effect";
import * as Errors from "../shared/errors.ts";
import * as Intent from "./intent.ts";

// The model places the pointer with a move, looks at it on the next image, and only then
// presses: a click takes no point of its own, and a drag names only where it ends. The
// harness remembers where the pointer is and fills the point the client still takes.
export type Point = { readonly x: string; readonly y: string };

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

const actionOf = (args: ReadonlyArray<string>): string => {
  const words: Array<string> = [];
  for (const arg of args) {
    if (arg.startsWith("-")) {
      break;
    }
    words.push(arg);
  }
  return words.join(" ");
};

const names = (args: ReadonlyArray<string>, flag: string): boolean =>
  args.some((arg) => arg === `--${flag}` || arg.startsWith(`--${flag}=`));

const pointOf = (args: ReadonlyArray<string>, x: string, y: string): Option.Option<Point> => {
  const atX = Intent.flag(args, x);
  const atY = Intent.flag(args, y);
  return atX === undefined || atY === undefined ? Option.none() : Option.some({ x: atX, y: atY });
};

// The harness's own moves, not the client's: the model is often that close to where it means to
// be. Two hundredths of the screenshot, y growing downward, clamped so an edge stays an edge.
const NUDGE = 0.02;
const NUDGES: Record<string, { readonly x: number; readonly y: number }> = {
  "mouse move-up": { x: 0, y: -NUDGE },
  "mouse move-down": { x: 0, y: NUDGE },
  "mouse move-left": { x: -NUDGE, y: 0 },
  "mouse move-right": { x: NUDGE, y: 0 },
};

// Rounded to a millionth so 0.56 + 0.02 is 0.58, not 0.5800000000000001.
const nudged = (at: string, by: number): string =>
  String(Math.round(Math.min(1, Math.max(0, Number(at) + by)) * 1_000_000) / 1_000_000);

export const placed = (
  args: ReadonlyArray<string>,
  at: Option.Option<Point>,
): Result.Result<ReadonlyArray<string>, Errors.ToolError> => {
  const action = actionOf(args);
  const nudge = NUDGES[action];
  if (nudge !== undefined) {
    if (names(args, "x") || names(args, "y")) {
      return fail(`${action}: takes no --x or --y; it moves from where the pointer is`);
    }
    if (Option.isNone(at)) {
      return fail(`${action}: no mouse move yet; mouse move to the point first`);
    }
    return Result.succeed([
      "mouse",
      "move",
      ...args.slice(2),
      "--x",
      nudged(at.value.x, nudge.x),
      "--y",
      nudged(at.value.y, nudge.y),
    ]);
  }
  if (action === "mouse click" || action === "mouse double-click") {
    if (names(args, "x") || names(args, "y")) {
      return fail(`${action}: takes no --x or --y; it clicks where the pointer is`);
    }
    if (Option.isNone(at)) {
      return fail(`${action}: no mouse move yet; mouse move to the point first`);
    }
    return Result.succeed([...args, "--x", at.value.x, "--y", at.value.y]);
  }
  if (action === "mouse drag") {
    if (names(args, "from-x") || names(args, "from-y")) {
      return fail(`${action}: takes no --from-x or --from-y; it starts where the pointer is`);
    }
    if (Option.isNone(at)) {
      return fail(`${action}: no mouse move yet; mouse move to where the drag starts first`);
    }
    return Result.succeed([...args, "--from-x", at.value.x, "--from-y", at.value.y]);
  }
  return Result.succeed(args);
};

// Where the pointer is once these args, as the client ran them, have succeeded.
export const after = (
  args: ReadonlyArray<string>,
  at: Option.Option<Point>,
): Option.Option<Point> => {
  const action = actionOf(args);
  if (action === "mouse drag") {
    return Option.orElse(pointOf(args, "to-x", "to-y"), () => at);
  }
  if (action.startsWith("mouse ")) {
    return Option.orElse(pointOf(args, "x", "y"), () => at);
  }
  return at;
};
