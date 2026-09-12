import { and, eq, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

type ServerRow = typeof DbSchema.servers.$inferSelect;
export type ServerType = ServerRow["type"];

export type LiveServer = {
  readonly id: string;
  readonly url: string;
};

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

    // Clients write every 30s; 45s is one missed beat plus a little. A null heartbeat is
    // an operator-added row no process has claimed, so it is not live.
    const listLiveServers = Effect.fn("db.listLiveServers")(function* (type: ServerType) {
      return yield* database.run("listLiveServers", (db) =>
        db
          .select({ id: DbSchema.servers.id, url: DbSchema.servers.url })
          .from(DbSchema.servers)
          .where(
            and(
              eq(DbSchema.servers.type, type),
              sql`${DbSchema.servers.heartbeatAt} > now() - interval '45 seconds'`,
            ),
          )
          .orderBy(DbSchema.servers.createdAt, DbSchema.servers.url),
      );
    });

    const findServer = Effect.fn("db.findServer")(function* (id: string) {
      const rows = yield* database.run("findServer", (db) =>
        db
          .select({ id: DbSchema.servers.id, url: DbSchema.servers.url })
          .from(DbSchema.servers)
          .where(eq(DbSchema.servers.id, id))
          .limit(1),
      );
      return Arr.head(rows);
    });

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

    // One row per agent: a racing second insert keeps the first server.
    const routeAgent = Effect.fn("db.routeAgent")(function* (agentId: string, url: string) {
      yield* database.run("routeAgent", (db) =>
        db.insert(DbSchema.agentServers).values({ agentId, serverUrl: url }).onConflictDoNothing(),
      );
    });

    const serverForAgent = Effect.fn("db.serverForAgent")(function* (agentId: string) {
      const rows = yield* database.run("serverForAgent", (db) =>
        db
          .select({ serverUrl: DbSchema.agentServers.serverUrl })
          .from(DbSchema.agentServers)
          .where(eq(DbSchema.agentServers.agentId, agentId)),
      );
      return Option.map(Arr.head(rows), (row) => row.serverUrl);
    });

    // Start consumed the reservation; the next reserve may place again.
    const clearAgent = Effect.fn("db.clearAgent")(function* (agentId: string) {
      yield* database.run("clearAgent", (db) =>
        db.delete(DbSchema.agentServers).where(eq(DbSchema.agentServers.agentId, agentId)),
      );
    });

    return {
      addServer,
      heartbeat,
      removeServer,
      listServers,
      listLiveServers,
      findServer,
      routeSession,
      serverForSession,
      routeAgent,
      serverForAgent,
      clearAgent,
    };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
