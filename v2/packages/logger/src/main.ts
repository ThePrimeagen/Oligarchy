import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as jarl from "jarl";
import * as Palette from "./palette.ts";
import * as Render from "./render.ts";

export type Level = "info" | "warning" | "error" | "fatal";

// location is a text bucket: a session id, or the process's own name.
export type Attribution = { readonly location?: string; readonly agentId?: string };

type Write = (text: string, attribution?: Attribution) => void;

export type Logger = {
  readonly service: "logger";
  readonly info: Write;
  readonly warning: Write;
  readonly error: Write;
  readonly fatal: Write;
  readonly flush: () => Promise<void>;
};

declare module "@oligarchy/app" {
  interface Services {
    logger: App.Register<"logger", Logger>;
  }
}

export type Options = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
  readonly now?: () => number;
};

// Rows go into the logs table one at a time in call order, and each line is written once its row
// has landed; a refused row is still written, followed by a line saying why, which is not stored.
// A connection the database drops is an error line of its own.
export const create = App.createService<Db.Database, Options, Logger>(({ db }, options) => {
  const { write, colors } = options;
  const now = options.now ?? Date.now;
  let palette = Palette.empty;
  let landed: Promise<void> = Promise.resolve();

  const print = (line: Render.Line) => {
    write(Render.renderLine(line, colors));
  };

  const keep = async (line: Render.Line, location: string | null) => {
    const stored = await db.run(async (d) => {
      await d.insert(DbSchema.logs).values({ text: line.text, level: line.level, location });
    });
    print(line);
    if (jarl.is_err(stored)) {
      print({ text: `db: log insert failed: ${stored.error.message}`, level: "error" });
    }
  };

  const emit =
    (level: Level): Write =>
    (text, attribution = {}) => {
      const { agentId, location } = attribution;
      let color: string | undefined;
      if (colors && agentId !== undefined) {
        const touched = Palette.touch(palette, agentId, now());
        palette = touched.palette;
        color = touched.color;
      }
      const line: Render.Line = {
        text,
        level,
        ...(agentId === undefined ? {} : { agentId }),
        ...(location === undefined ? {} : { location }),
        ...(color === undefined ? {} : { color }),
      };
      landed = landed.then(() => keep(line, location ?? null));
    };

  const error = emit("error");
  db.onPoolError((cause) => {
    error(`db: pool error: ${cause.message}`);
  });

  return {
    service: "logger",
    info: emit("info"),
    warning: emit("warning"),
    error,
    fatal: emit("fatal"),
    flush: () => landed,
  };
});
