import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import type { Answer } from "./answer.ts";

export type MoveRow = typeof DbSchema.moves.$inferSelect;

// A guest move names its tool, the ActionList step it worked on, the model's reason and the
// tool's own arguments; outcome is what the guest answered, or why it refused. A refused reply
// ran nothing: its outcome is why, and its step the one open then, null before any opened.
export type MoveInput =
  | {
      readonly jobId: string;
      readonly kind: "move";
      readonly step: number;
      readonly name: string;
      readonly reason: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly outcome: string;
    }
  | {
      readonly jobId: string;
      readonly kind: "refused";
      readonly step: number | null;
      readonly outcome: string;
    };

export type Moves = {
  readonly service: "moves";
  readonly recordMove: (input: MoveInput) => Answer<void>;
};

declare module "@oligarchy/app" {
  interface Services {
    moves: App.Register<"moves", Moves>;
  }
}

export const create = App.createService<Db.Database, App.NoOptions, Moves>(({ db }) => ({
  service: "moves",

  recordMove: (input) =>
    db.run(async (d) => {
      await d.insert(DbSchema.moves).values(input);
    }),
}));
