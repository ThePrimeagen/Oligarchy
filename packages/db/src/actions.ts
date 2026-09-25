import { desc, eq, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import type * as Domain from "@oligarchy/shared/domain";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type ActionInput = {
  readonly sessionId: string;
  readonly agentId: string;
  readonly request: Domain.QmpCommand;
};

export type ImageInput = { readonly id: string; readonly data: Uint8Array };

export class ActionStore extends Context.Service<ActionStore>()("@oligarchy/db/ActionStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    const startAction = Effect.fn("db.startAction")(function* (input: ActionInput) {
      const [row] = yield* database.run("startAction", (db) =>
        db
          .insert(DbSchema.actions)
          .values({ sessionId: input.sessionId, agentId: input.agentId, request: input.request })
          .returning({ id: DbSchema.actions.id }),
      );
      return row.id;
    });

    // The images row rides the transaction that closes its action: they are 1:1.
    const finishAction = Effect.fn("db.finishAction")(function* (
      id: number,
      outcome: Domain.QmpExchangeOutcome,
      image?: ImageInput,
    ) {
      const close = { state: outcome.state, response: outcome.response, finishedAt: sql`now()` };
      if (image === undefined) {
        yield* database.run("finishAction", (db) =>
          db.update(DbSchema.actions).set(close).where(eq(DbSchema.actions.id, id)),
        );
        return;
      }
      yield* database.transaction("finishAction", (tx) =>
        Effect.gen(function* () {
          yield* Client.attempt("finishAction", () =>
            tx.update(DbSchema.actions).set(close).where(eq(DbSchema.actions.id, id)),
          );
          yield* Client.attempt("finishAction", () =>
            tx
              .insert(DbSchema.images)
              .values({ id: image.id, actionId: id, data: Buffer.from(image.data) }),
          );
        }),
      );
    });

    const getImage = Effect.fn("db.getImage")(function* (id: string) {
      const rows = yield* database.run("getImage", (db) =>
        db
          .select({ data: DbSchema.images.data })
          .from(DbSchema.images)
          .where(eq(DbSchema.images.id, id)),
      );
      return Option.map(Arr.head(rows), (row): Uint8Array => row.data);
    });

    const listActions = Effect.fn("db.listActions")(function* (sessionId: string) {
      return yield* database.run("listActions", (db) =>
        db
          .select()
          .from(DbSchema.actions)
          .where(eq(DbSchema.actions.sessionId, sessionId))
          .orderBy(DbSchema.actions.createdAt, DbSchema.actions.id),
      );
    });

    // The session's screenshots in the order they were taken; the bytes stay behind `getImage`.
    const listImages = Effect.fn("db.listImages")(function* (sessionId: string) {
      return yield* database.run("listImages", (db) =>
        db
          .select({
            id: DbSchema.images.id,
            actionId: DbSchema.images.actionId,
            createdAt: DbSchema.actions.createdAt,
          })
          .from(DbSchema.images)
          .innerJoin(DbSchema.actions, eq(DbSchema.images.actionId, DbSchema.actions.id))
          .where(eq(DbSchema.actions.sessionId, sessionId))
          .orderBy(DbSchema.actions.createdAt, DbSchema.actions.id),
      );
    });

    // The session's newest `limit` actions, oldest first, without their responses: what a watcher
    // polling the session needs, every second.
    const listRecentActions = Effect.fn("db.listRecentActions")(function* (
      sessionId: string,
      limit: number,
    ) {
      const rows = yield* database.run("listRecentActions", (db) =>
        db
          .select({
            id: DbSchema.actions.id,
            request: DbSchema.actions.request,
            state: DbSchema.actions.state,
            createdAt: DbSchema.actions.createdAt,
            finishedAt: DbSchema.actions.finishedAt,
          })
          .from(DbSchema.actions)
          .where(eq(DbSchema.actions.sessionId, sessionId))
          .orderBy(desc(DbSchema.actions.id))
          .limit(limit),
      );
      return rows.reverse();
    });

    return { startAction, finishAction, getImage, listActions, listImages, listRecentActions };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
