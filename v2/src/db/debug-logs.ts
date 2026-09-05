import { Context, Effect, Layer } from "effect";
import * as Actions from "./actions.ts";
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

const formatActions = (
  rows: ReadonlyArray<{
    readonly id: number;
    readonly createdAt: Date;
    readonly state: string | null;
    readonly request: unknown;
    readonly response: unknown;
  }>,
): string =>
  rows
    .map((row) => {
      const state = row.state ?? "open";
      const response = row.response === null ? "" : ` ${JSON.stringify(row.response)}`;
      return `${row.createdAt.toISOString()} ${String(row.id)} ${state} ${JSON.stringify(row.request)}${response}`;
    })
    .join("\n");

export class DebugLogStore extends Context.Service<DebugLogStore>()("@oligarchy/db/DebugLogStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;
    const logs = yield* Logs.LogStore;
    const actions = yield* Actions.ActionStore;

    const saveFailedSession = Effect.fn("db.saveFailedSession")(function* (
      sessionId: string,
      captured: { readonly serial: string; readonly qemu: string },
    ) {
      const logRows = yield* logs.listLogs(sessionId);
      const actionRows = yield* actions.listActions(sessionId);
      yield* database.run("saveFailedSession", (db) =>
        db.insert(DbSchema.debugLogs).values({
          sessionId,
          sources: {
            serial: truncateDebugText(captured.serial),
            proxy: truncateDebugText(formatProxyLogs(logRows)),
            qemu: truncateDebugText(captured.qemu),
            actions: truncateDebugText(formatActions(actionRows)),
          },
        }),
      );
    });

    return { saveFailedSession };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
