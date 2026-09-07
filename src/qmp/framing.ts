import { Cause, Exit, Result } from "effect";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

export type Frame = Result.Result<Domain.QmpInbound, Errors.QmpProtocolError>;

export type Split = {
  readonly frames: ReadonlyArray<string>;
  readonly rest: string;
};

export type Fed = {
  readonly frames: ReadonlyArray<Frame>;
  readonly rest: string;
};

// The end index (exclusive) of the first complete top-level object in `buffer`, or -1.
// Braces inside JSON string values must not move the depth, or a QMP error whose desc quotes a
// brace (e.g. a rejected key token) mis-frames the reply.
const closingBrace = (buffer: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
};

// Every complete top-level object in `buffer`, in order, and the unconsumed tail.
export const split = (buffer: string): Split => {
  const frames: Array<string> = [];
  let rest = buffer;
  for (;;) {
    const start = rest.indexOf("{");
    if (start < 0) {
      return { frames, rest };
    }
    const end = closingBrace(rest, start);
    if (end < 0) {
      return { frames, rest };
    }
    frames.push(rest.slice(start, end));
    rest = rest.slice(end);
  }
};

export const decodeFrame = (frame: string): Frame => {
  const exit = Domain.decodeQmpInbound(frame);
  return Exit.isSuccess(exit)
    ? Result.succeed(exit.value)
    : Result.fail(
        Errors.QmpProtocolError.make({
          message: `qemu: invalid QMP frame: ${frame}`,
          cause: Cause.squash(exit.cause),
        }),
      );
};

// Appends a chunk to the buffered tail and decodes every frame that completes.
export const feed = (rest: string, chunk: string): Fed => {
  const found = split(rest + chunk);
  return { frames: found.frames.map(decodeFrame), rest: found.rest };
};
