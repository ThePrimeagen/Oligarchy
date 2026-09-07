import { Effect, Layer, Sink, Stdio } from "effect";

export type Captured = {
  readonly stdout: Array<Uint8Array>;
  readonly stderr: Array<Uint8Array>;
  readonly layer: Layer.Layer<Stdio.Stdio>;
};

const encoder = new TextEncoder();

const chunk = (value: string | Uint8Array): Uint8Array =>
  typeof value === "string" ? encoder.encode(value) : value;

const collecting = (into: Array<Uint8Array>) => () =>
  Sink.forEach((value: string | Uint8Array) =>
    Effect.sync(() => {
      into.push(chunk(value));
    }),
  );

// A Stdio whose stdout and stderr keep their raw chunks, for byte-exact output assertions.
export const capture = (
  options: {
    readonly args?: ReadonlyArray<string>;
    readonly stdoutIsTerminal?: boolean;
  } = {},
): Captured => {
  const stdout: Array<Uint8Array> = [];
  const stderr: Array<Uint8Array> = [];
  return {
    stdout,
    stderr,
    layer: Stdio.layerTest({
      args: Effect.succeed(options.args ?? []),
      stdoutIsTerminal: Effect.succeed(options.stdoutIsTerminal ?? false),
      stdout: collecting(stdout),
      stderr: collecting(stderr),
    }),
  };
};

export const text = (chunks: ReadonlyArray<Uint8Array>): string =>
  chunks.map((piece) => new TextDecoder().decode(piece)).join("");
