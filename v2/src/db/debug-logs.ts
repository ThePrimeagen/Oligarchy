import { Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as Logs from "./logs.ts";
import * as DbSchema from "./schema.ts";

// PlanetScale Postgres will take more, but a full journal plus the proxy story is diagnostic
// in the first megabyte; a larger insert is a row we do not need to carry. The tail is kept:
// the crash and the verdict are at the end.
const MAX_DEBUG_TEXT = 1_048_576;
const TRUNCATED = "[truncated]\n";

const truncateDebugText = (text: string): string =>
  text.length <= MAX_DEBUG_TEXT
    ? text
    : `${TRUNCATED}${text.slice(TRUNCATED.length - MAX_DEBUG_TEXT)}`;

const formatProxyLogs = (
  rows: ReadonlyArray<{ readonly level: string; readonly text: string; readonly createdAt: Date }>,
): string =>
  rows.map((row) => `${row.createdAt.toISOString()} ${row.level} ${row.text}`).join("\n");

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

    return { saveFailedSession };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
