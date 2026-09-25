import { WriteStream } from "node:tty";

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

// Decided once for the process; an entry that builds a Log provides it as `Log.Colors`.
export const stdoutColors: boolean = wantsColor(process.stdout, process.env);
