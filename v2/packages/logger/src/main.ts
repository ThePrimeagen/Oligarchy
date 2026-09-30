import type * as App from "@oligarchy/app";
import type * as Sentry from "@oligarchy/sentry";
import * as jarl from "jarl";
import * as Palette from "./palette.ts";
import * as Render from "./render.ts";

export type Level = "info" | "warning" | "error" | "fatal";

// location is a text bucket: a session id, or the process's own name.
export type Attribution = { readonly location?: string; readonly agentId?: string };

// What an error or fatal line hands Sentry besides its text: the cause Sentry is sent in the
// text's place, or skipSentry to send nothing.
export type Report = Attribution & { readonly cause?: unknown; readonly skipSentry?: true };

export type Row = {
  readonly text: string;
  readonly level: Level;
  readonly location: string | null;
  readonly agentId: string | null;
};

export type Store = (row: Row) => Promise<jarl.Result<void, { readonly message: string }>>;

type Write = (text: string, attribution?: Attribution) => void;
type Reported = (text: string, report?: Report) => void;

export type Logger = {
  readonly service: "logger";
  readonly info: Write;
  readonly warning: Write;
  readonly error: Reported;
  readonly fatal: Reported;
  readonly flush: () => Promise<void>;
};

declare module "@oligarchy/app" {
  interface Services {
    logger: App.Register<"logger", Logger>;
  }
}

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

const sentryReport = (
  level: "error" | "fatal",
  text: string,
  attribution: Attribution,
): Sentry.Report => {
  const tags = {
    ...(attribution.location === undefined ? {} : { location: attribution.location }),
    ...(attribution.agentId === undefined ? {} : { agent_id: attribution.agentId }),
  };
  return { level, tags, extra: { log: text, ...tags } };
};

// Without a store a line is written at once. With one, rows are stored one at a time in call
// order and each line is written once its row has landed; a refused row is still written,
// followed by a line saying why, which is not stored. An error or fatal line goes to Sentry when
// it is logged, as its cause or else as its text; a refused row's failure goes too.
export const create = (options: {
  readonly write: (line: string) => void;
  readonly colors: boolean;
  readonly store?: Store;
  readonly sentry?: Pick<Sentry.Sentry, "send">;
  readonly now?: () => number;
}): Logger => {
  const { write, colors, store, sentry } = options;
  const now = options.now ?? Date.now;
  let palette = Palette.empty;
  let landed: Promise<void> = Promise.resolve();

  const print = (line: Render.Line) => {
    write(Render.renderLine(line, colors));
  };

  const keep = async (line: Render.Line, row: Row, into: Store) => {
    let failure: { readonly error: unknown; readonly message: string } | undefined;
    try {
      const stored = await into(row);
      if (jarl.is_err(stored)) {
        failure = { error: stored.error, message: stored.error.message };
      }
    } catch (thrown) {
      failure = { error: thrown, message: messageOf(thrown) };
    }
    print(line);
    if (failure !== undefined) {
      const text = `db: log insert failed: ${failure.message}`;
      print({ text, level: "error" });
      sentry?.send(failure.error, sentryReport("error", text, {}));
    }
  };

  const emit =
    (level: Level): Reported =>
    (text, report = {}) => {
      const { agentId, location } = report;
      let color: string | undefined;
      if (colors && agentId !== undefined) {
        const touched = Palette.touch(palette, agentId, now());
        palette = touched.palette;
        color = touched.color;
      }
      if ((level === "error" || level === "fatal") && report.skipSentry !== true) {
        sentry?.send(report.cause ?? new Error(text), sentryReport(level, text, report));
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
