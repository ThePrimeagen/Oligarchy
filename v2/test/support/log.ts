import { Effect, Layer } from "effect";
import * as Log from "../../src/observability/log.ts";

export type Line = {
  readonly level: "info" | "warning" | "error" | "fatal";
  readonly text: string;
  readonly sessionId: string | undefined;
  readonly agentId: string | undefined;
  readonly skipSentry: boolean;
  readonly cause: unknown;
};

export type FakeLog = {
  readonly lines: Array<Line>;
  readonly released: Array<string>;
  readonly layer: Layer.Layer<Log.Log>;
};

// A Log that records every line instead of printing or persisting it.
export const fakeLog = (): FakeLog => {
  const lines: Array<Line> = [];
  const released: Array<string> = [];
  const record =
    (level: Line["level"]) =>
    (text: string, report?: Log.Report): Effect.Effect<void> =>
      Effect.sync(() => {
        lines.push({
          level,
          text,
          sessionId: report?.sessionId,
          agentId: report?.agentId,
          skipSentry: report?.skipSentry === true,
          cause: report?.cause,
        });
      });
  const service: Log.LogService = {
    info: record("info"),
    warning: record("warning"),
    error: record("error"),
    fatal: record("fatal"),
    releaseColor: (agentId) =>
      Effect.sync(() => {
        released.push(agentId);
      }),
    flush: Effect.void,
  };
  return { lines, released, layer: Layer.succeed(Log.Log)(service) };
};

export const texts = (log: FakeLog): ReadonlyArray<string> => log.lines.map((line) => line.text);
