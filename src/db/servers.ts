import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

type ServerRow = typeof DbSchema.servers.$inferSelect;
export type ServerType = ServerRow["type"];

export class ServerStore extends Context.Service<ServerStore>()("@oligarchy/db/ServerStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    // Registering a url twice is one row: the probe already said the server is there.
    const addServer = Effect.fn("db.addServer")(function* (url: string, type: ServerType) {
      yield* database.run("addServer", (db) =>
        db.insert(DbSchema.servers).values({ url, type }).onConflictDoNothing(),
      );
    });

    // A server's own word on itself, its kind included: its row comes into being on the first
    // heartbeat or is rewritten, the generation counting every write, stamped by the database's
    // clock.
    const heartbeat = Effect.fn("db.heartbeat")(function* (
      url: string,
      type: ServerType,
      stats: DbSchema.ServerStats,
    ) {
      const now = sql`now()`;
      yield* database.run("heartbeat", (db) =>
        db
          .insert(DbSchema.servers)
          .values({ url, type, stats, generation: 1, heartbeatAt: now })
          .onConflictDoUpdate({
            target: DbSchema.servers.url,
            set: {
              type,
              stats,
              generation: sql`${DbSchema.servers.generation} + 1`,
              heartbeatAt: now,
            },
          }),
      );
    });

    // false when nothing was registered under the url: the command turns that into its 404.
    const removeServer = Effect.fn("db.removeServer")(function* (url: string) {
      const rows = yield* database.run("removeServer", (db) =>
        db
          .delete(DbSchema.servers)
          .where(eq(DbSchema.servers.url, url))
          .returning({ url: DbSchema.servers.url }),
      );
      return rows.length > 0;
    });

    // The servers of one kind, in registration order, so a placement tie goes to the server that
    // was there first.
    const listServers = Effect.fn("db.listServers")(function* (type: ServerType) {
      const rows = yield* database.run("listServers", (db) =>
        db
          .select({ url: DbSchema.servers.url })
          .from(DbSchema.servers)
          .where(eq(DbSchema.servers.type, type))
          .orderBy(DbSchema.servers.createdAt, DbSchema.servers.url),
      );
      return rows.map((row) => row.url);
    });

    // Automation rows with stats and a heartbeat within ninety seconds, in registration order.
    const listAutomationClients = database
      .run("listAutomationClients", (db) =>
        db
          .select({
            url: DbSchema.servers.url,
            stats: DbSchema.servers.stats,
          })
          .from(DbSchema.servers)
          .where(
            and(
              eq(DbSchema.servers.type, "automation"),
              isNotNull(DbSchema.servers.stats),
              sql`${DbSchema.servers.heartbeatAt} > now() - interval '90 seconds'`,
            ),
          )
          .orderBy(DbSchema.servers.createdAt, DbSchema.servers.url),
      )
      .pipe(
        Effect.map((rows) =>
          rows.flatMap((row) =>
            row.stats !== null && "agents" in row.stats
              ? [{ url: row.url, agents: row.stats.agents }]
              : [],
          ),
        ),
        Effect.withSpan("db.listAutomationClients"),
      );

    // A session is routed once; a second insert is the primary key's DatabaseError by design.
    const routeSession = Effect.fn("db.routeSession")(function* (sessionId: string, url: string) {
      yield* database.run("routeSession", (db) =>
        db.insert(DbSchema.sessionServers).values({ sessionId, serverUrl: url }),
      );
    });

    const serverForSession = Effect.fn("db.serverForSession")(function* (sessionId: string) {
      const rows = yield* database.run("serverForSession", (db) =>
        db
          .select({ serverUrl: DbSchema.sessionServers.serverUrl })
          .from(DbSchema.sessionServers)
          .where(eq(DbSchema.sessionServers.sessionId, sessionId)),
      );
      return Option.map(Arr.head(rows), (row) => row.serverUrl);
    });

    return {
      addServer,
      heartbeat,
      removeServer,
      listServers,
      listAutomationClients,
      routeSession,
      serverForSession,
    };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
