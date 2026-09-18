import { Context, Effect, FileSystem, Schema } from "effect";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";

// What the screen asks for lives here, not in the environment: a missing file is the
// default, a present file that does not parse is a refusal. `tickets` is how many
// finished tickets a cycle keeps; the live queue is never cut.
export const PATH = ".oligarchy-viz.json";
export const DEFAULT_TICKETS = 25;

export type Settings = {
  readonly tickets: number;
};

const TicketCount = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, { message: "tickets must be at least 1" }),
).annotate({ identifier: "@oligarchy/viz/settings/TicketCount" });

const File = Schema.Struct({
  tickets: Schema.optionalKey(TicketCount),
}).annotate({ identifier: "@oligarchy/viz/settings/File" });

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(File), {
  onExcessProperty: "error",
});

const refused = (error: unknown): Errors.CommandError =>
  Errors.CommandError.make({ message: `${PATH}: ${Render.headline(error)}` });

export const parse = (text: string): Effect.Effect<Settings, Errors.CommandError> =>
  decodeFile(text).pipe(
    Effect.mapError(refused),
    Effect.map((file) => ({ tickets: file.tickets ?? DEFAULT_TICKETS })),
  );

// The working directory's file, read when viz opens. Absent is the default.
export const load: Effect.Effect<Settings, Errors.CommandError, FileSystem.FileSystem> = Effect.gen(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const there = yield* fs.exists(PATH).pipe(Effect.mapError(refused));
    if (!there) {
      return { tickets: DEFAULT_TICKETS };
    }
    const text = yield* fs.readFileString(PATH).pipe(Effect.mapError(refused));
    return yield* parse(text);
  },
);

// How many finished tickets this process keeps. Tests leave the default.
export const Tickets = Context.Reference<number>("@oligarchy/viz/settings/Tickets", {
  defaultValue: () => DEFAULT_TICKETS,
});
