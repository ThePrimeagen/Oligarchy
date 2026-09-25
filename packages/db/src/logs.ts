import { and, desc, eq, like, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type * as Domain from "@oligarchy/shared/domain";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type LogRow = {
  readonly text: string;
  readonly level: Domain.LogLevel;
  readonly location: string | null;
  readonly agentId: string | null;
};

export class LogStore extends Context.Service<LogStore>()("@oligarchy/db/LogStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    const insertLog = Effect.fn("db.insertLog")(function* (row: LogRow) {
      yield* database.run("insertLog", (db) => db.insert(DbSchema.logs).values(row));
    });

    // Rows for one location bucket: a session UUID, "server", or "automation".
    const listLogs = Effect.fn("db.listLogs")(function* (location: string) {
      return yield* database.run("listLogs", (db) =>
        db
          .select()
          .from(DbSchema.logs)
          .where(eq(DbSchema.logs.location, location))
          .orderBy(DbSchema.logs.createdAt, DbSchema.logs.id),
      );
    });

    // The newest rows from every bucket, oldest first: a tail, not one session's history.
    const listRecent = Effect.fn("db.listRecentLogs")(function* (limit: number) {
      const rows = yield* database.run("listRecentLogs", (db) =>
        db.select().from(DbSchema.logs).orderBy(desc(DbSchema.logs.id)).limit(limit),
      );
      return rows.reverse();
    });

    // A session's `intent start; <message>` and `intent end` lines, oldest first: the steps the
    // agent said, which are recorded nowhere else.
    const listIntents = Effect.fn("db.listIntents")(function* (sessionId: string) {
      return yield* database.run("listIntents", (db) =>
        db
          .select({ text: DbSchema.logs.text, createdAt: DbSchema.logs.createdAt })
          .from(DbSchema.logs)
          .where(
            and(
              eq(DbSchema.logs.location, sessionId),
              or(like(DbSchema.logs.text, "intent start; %"), eq(DbSchema.logs.text, "intent end")),
            ),
          )
          .orderBy(DbSchema.logs.id),
      );
    });

    return { insertLog, listLogs, listRecent, listIntents };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
