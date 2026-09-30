// A fake logger for tests: each line printed at once as the logger renders it, nothing stored or
// sent, and every call kept as it was made.
import * as App from "@oligarchy/app";
import type * as Logger from "./main.ts";
import * as Palette from "./palette.ts";
import * as Render from "./render.ts";

export type Said = {
  readonly level: Logger.Level;
  readonly text: string;
  readonly report: Logger.Report;
};

export const logger = (
  options: { readonly colors?: boolean; readonly now?: () => number } = {},
): {
  readonly logger: App.Made<Logger.Logger>;
  // Every line, as the logger would write it.
  readonly lines: ReadonlyArray<string>;
  readonly said: ReadonlyArray<Said>;
} => {
  const colors = options.colors ?? false;
  const now = options.now ?? Date.now;
  const lines: Array<string> = [];
  const said: Array<Said> = [];
  let palette = Palette.empty;

  const emit =
    (level: Logger.Level) =>
    (text: string, report: Logger.Report = {}) => {
      said.push({ level, text, report });
      const { agentId, location } = report;
      let color: string | undefined;
      if (colors && agentId !== undefined) {
        const touched = Palette.touch(palette, agentId, now());
        palette = touched.palette;
        color = touched.color;
      }
      lines.push(
        Render.renderLine(
          {
            text,
            level,
            ...(agentId === undefined ? {} : { agentId }),
            ...(location === undefined ? {} : { location }),
            ...(color === undefined ? {} : { color }),
          },
          colors,
        ),
      );
    };

  const create = App.createService<never, void, Logger.Logger>(() => ({
    service: "logger",
    info: emit("info"),
    warning: emit("warning"),
    error: emit("error"),
    fatal: emit("fatal"),
    flush: () => Promise.resolve(),
  }));
  return { logger: create({}), lines, said };
};
