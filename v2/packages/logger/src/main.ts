import type * as App from "@oligarchy/app";
import type * as jarl from "jarl";
import * as Palette from "./palette.ts";
import * as Render from "./render.ts";

export type Level = "info" | "warning" | "error" | "fatal";

// location is a text bucket: a session id, or the process's own name.
export type Attribution = { readonly location?: string; readonly agentId?: string };

export type Row = {
  readonly text: string;
  readonly level: Level;
  readonly location: string | null;
  readonly agentId: string | null;
};

export type Store = (row: Row) => Promise<jarl.Result<void, { readonly message: string }>>;

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

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

// Without a store a line is written at once. With one, rows are stored one at a time in call
// order and each line is written once its row has landed; a refused row is still written,
// followed by a line saying why, which is not stored.
export const create = (options: {
  readonly write: (line: string) => void;
  readonly colors: boolean;
  readonly store?: Store;
  readonly now?: () => number;
}): Logger => {
  const { write, colors, store } = options;
  const now = options.now ?? Date.now;
  let palette = Palette.empty;
  let landed: Promise<void> = Promise.resolve();

  const print = (line: Render.Line) => {
    write(Render.renderLine(line, colors));
  };

  const keep = async (line: Render.Line, row: Row, into: Store) => {
    let failure: string | undefined;
    try {
      const stored = await into(row);
      failure = stored.ok ? undefined : stored.error.message;
    } catch (thrown) {
      failure = messageOf(thrown);
    }
    print(line);
    if (failure !== undefined) {
      print({ text: `db: log insert failed: ${failure}`, level: "error" });
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
      if (store === undefined) {
        print(line);
        return;
      }
      const row: Row = { text, level, location: location ?? null, agentId: agentId ?? null };
      landed = landed.then(() => keep(line, row, store));
    };

  return {
    service: "logger",
    info: emit("info"),
    warning: emit("warning"),
    error: emit("error"),
    fatal: emit("fatal"),
    flush: () => landed,
  };
};
