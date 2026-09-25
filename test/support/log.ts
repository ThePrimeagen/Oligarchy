import { Effect, Layer } from "effect";
import * as Log from "@oligarchy/log/log";

export type Line = {
  readonly level: "info" | "warning" | "error" | "fatal";
  readonly text: string;
  readonly location: string | undefined;
  readonly agentId: string | undefined;
  readonly skipSentry: boolean;
  readonly cause: unknown;
};

export type FakeLog = {
  readonly lines: Array<Line>;
  readonly layer: Layer.Layer<Log.Log>;
};

// A Log that records every line instead of printing or persisting it.
export const fakeLog = (): FakeLog => {
  const lines: Array<Line> = [];
  const record =
    (level: Line["level"]) =>
    (text: string, report?: Log.Report): Effect.Effect<void> =>
      Effect.sync(() => {
        lines.push({
          level,
          text,
          location: report?.location,
          agentId: report?.agentId,
          skipSentry: report?.skipSentry === true,
          cause: report?.cause,
        });
      });
  return {
    lines,
    layer: Layer.succeed(Log.Log)(
      Log.Log.of({
        info: record("info"),
        warning: record("warning"),
        error: record("error"),
        fatal: record("fatal"),
        flush: Effect.void,
      }),
    ),
  };
};

export const texts = (log: FakeLog): ReadonlyArray<string> => log.lines.map((line) => line.text);
