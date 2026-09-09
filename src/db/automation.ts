import { Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
export type AutomationAction = AutomationJobRow["action"];

export type EnqueueInput = {
  readonly resultId: string;
  readonly action: AutomationAction;
};

export class AutomationStore extends Context.Service<AutomationStore>()(
  "@oligarchy/db/AutomationStore",
  {
    make: Effect.gen(function* () {
      const database = yield* Client.Database;

      // Insert a pending job. A second (result_id, action) is the unique index's DatabaseError.
      const enqueue = Effect.fn("db.enqueueAutomationJob")(function* (input: EnqueueInput) {
        const [row] = yield* database.run("enqueueAutomationJob", (db) =>
          db
            .insert(DbSchema.automationJobs)
            .values({ resultId: input.resultId, action: input.action, status: "pending" })
            .returning(),
        );
        return row;
      });

      return { enqueue };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
