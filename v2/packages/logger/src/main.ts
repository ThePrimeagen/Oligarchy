import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import type * as Sentry from "@oligarchy/sentry";
import * as jarl from "jarl";
import * as Palette from "./palette.ts";
import * as Render from "./render.ts";

export type Level = "info" | "warning" | "error" | "fatal";

// jobId identifies the job in terminal output and Sentry; runId associates database logs
// with its parent test run. location names the process or another text bucket.
export type Attribution = {
  readonly location?: string;
  readonly jobId?: string;
  readonly runId?: string;
};

// What an error or fatal line hands Sentry besides its text: the cause Sentry is sent in the
// text's place, or skipSentry to send nothing.
export type Report = Attribution & { readonly cause?: unknown; readonly skipSentry?: true };

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

const sentryReport = (
  level: "error" | "fatal",
  text: string,
  attribution: Attribution,
): Sentry.JobReport => {
  const tags = {
    ...(attribution.location === undefined ? {} : { location: attribution.location }),
    ...(attribution.jobId === undefined ? {} : { job_id: attribution.jobId }),
  };
  return {
    level,
    tags,
    extra: { log: text, ...tags },
    ...(attribution.jobId === undefined ? {} : { jobId: attribution.jobId }),
  };
};

export type Options = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
  readonly now?: () => number;
};

// Rows go into the logs table one at a time in call order, and each line is written once its row
// has landed; a refused row is still written, followed by a line saying why, which is not stored.
// An error or fatal line goes to Sentry when it is logged, as its cause or else as its text; a
// refused row's failure goes too. A connection the database drops is an error line of its own.
export const create = App.createService<Sentry.Sentry | Db.Database, Options, Logger>(
  ({ sentry, db }, options) => {
    const { write, colors } = options;
    const now = options.now ?? Date.now;
    let palette = Palette.empty;
    let landed: Promise<void> = Promise.resolve();

    const print = (line: Render.Line) => {
      write(Render.renderLine(line, colors));
    };

    const keep = async (line: Render.Line, location: string | null, runId: string | null) => {
      const stored = await db.run(async (d) => {
        await d
          .insert(DbSchema.logs)
          .values({ text: line.text, level: line.level, location, runId });
      });
      print(line);
      if (jarl.is_err(stored)) {
        const text = `db: log insert failed: ${stored.error.message}`;
        print({ text, level: "error" });
        sentry.send(stored.error, sentryReport("error", text, {}));
      }
    };

    const emit =
      (level: Level): Reported =>
      (text, report = {}) => {
        const { jobId, location } = report;
        let color: string | undefined;
        if (colors && jobId !== undefined) {
          const touched = Palette.touch(palette, jobId, now());
          palette = touched.palette;
          color = touched.color;
        }
        if ((level === "error" || level === "fatal") && report.skipSentry !== true) {
          sentry.send(report.cause ?? new Error(text), sentryReport(level, text, report));
        }
        const line: Render.Line = {
          text,
          level,
          ...(jobId === undefined ? {} : { jobId }),
          ...(location === undefined ? {} : { location }),
          ...(color === undefined ? {} : { color }),
        };
        landed = landed.then(() => keep(line, location ?? null, report.runId ?? null));
      };

    const error = emit("error");
    db.onPoolError((cause) => {
      error(`db: pool error: ${cause.message}`, { cause });
    });

    return {
      service: "logger",
      info: emit("info"),
      warning: emit("warning"),
      error,
      fatal: emit("fatal"),
      flush: () => landed,
    };
  },
);
