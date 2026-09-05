import { eq } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Client from "./client.ts";
import * as Logs from "./logs.ts";
import * as DbSchema from "./schema.ts";

// PlanetScale Postgres will take more, but a full journal plus the proxy story is diagnostic
// in the first megabyte; a larger insert is a row we do not need to carry.
export const MAX_DEBUG_TEXT = 1_048_576;

export const truncateDebugText = (text: string): string =>
  text.length <= MAX_DEBUG_TEXT ? text : `${text.slice(0, MAX_DEBUG_TEXT)}\n[truncated]`;

export type ProxyLogRow = {
  readonly level: Domain.LogLevel;
  readonly text: string;
  readonly createdAt: Date;
};

export const formatProxyLogs = (rows: ReadonlyArray<ProxyLogRow>): string =>
  rows.map((row) => `${row.createdAt.toISOString()} ${row.level} ${row.text}`).join("\n");

export type DebugLog = {
  readonly sessionId: string;
  readonly serial: string;
  readonly proxyLogs: string;
};

export class DebugLogStore extends Context.Service<DebugLogStore>()("@oligarchy/db/DebugLogStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;
    const logs = yield* Logs.LogStore;

    const saveFailedSession = Effect.fn("db.saveFailedSession")(function* (
      sessionId: string,
      serial: string,
    ) {
      const rows = yield* logs.listLogs(sessionId);
      yield* database.run("saveFailedSession", (db) =>
        db.insert(DbSchema.debugLogs).values({
          sessionId,
          serial: truncateDebugText(serial),
          proxyLogs: truncateDebugText(formatProxyLogs(rows)),
        }),
      );
    });

    const getDebugLog = Effect.fn("db.getDebugLog")(function* (sessionId: string) {
      const rows = yield* database.run("getDebugLog", (db) =>
        db.select().from(DbSchema.debugLogs).where(eq(DbSchema.debugLogs.sessionId, sessionId)),
      );
      return Option.map(Arr.head(rows), (row): DebugLog => ({
        sessionId: row.sessionId,
        serial: row.serial,
        proxyLogs: row.proxyLogs,
      }));
    });

    return { saveFailedSession, getDebugLog };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
