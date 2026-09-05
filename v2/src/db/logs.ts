import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type LogRow = {
  readonly text: string;
  readonly level: Domain.LogLevel;
  readonly sessionId: string | null;
  readonly agentId: string | null;
};

export class LogStore extends Context.Service<LogStore>()("@oligarchy/db/LogStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    const insertLog = Effect.fn("db.insertLog")(function* (row: LogRow) {
      yield* database.run("insertLog", (db) => db.insert(DbSchema.logs).values(row));
    });

    const listLogs = Effect.fn("db.listLogs")(function* (sessionId: string) {
      return yield* database.run("listLogs", (db) =>
        db
          .select()
          .from(DbSchema.logs)
          .where(eq(DbSchema.logs.sessionId, sessionId))
          .orderBy(DbSchema.logs.createdAt, DbSchema.logs.id),
      );
    });

    return { insertLog, listLogs };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
