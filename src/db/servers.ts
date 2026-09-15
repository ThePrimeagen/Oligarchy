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

// One machine of either kind with what it last said of itself, and the database's clock at the
// read, so a heartbeat's age is measured against the clock that stamped it. stats and
// heartbeat_at are null together, for a row an operator added that no server has claimed.
export type Machine = {
  readonly url: string;
  readonly name: string | null;
  readonly type: ServerType;
  readonly stats: DbSchema.ServerStats | null;
  readonly generation: number;
  readonly heartbeatAt: Date | null;
  readonly queriedAt: Date;
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
      name: string,
      stats: DbSchema.ServerStats,
    ) {
      const now = sql`now()`;
      yield* database.run("heartbeat", (db) =>
        db
          .insert(DbSchema.servers)
          .values({ url, name, type, stats, generation: 1, heartbeatAt: now })
          .onConflictDoUpdate({
            target: DbSchema.servers.url,
            set: {
              name,
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

    // Every machine as the viz lists it: the qemu servers before the automation clients, as the
    // enum declares the kinds, each kind in registration order.
    const listMachines = Effect.fn("db.listMachines")(function* () {
      const rows: ReadonlyArray<Machine> = yield* database.run("listMachines", (db) =>
        db
          .select({
            url: DbSchema.servers.url,
            name: DbSchema.servers.name,
            type: DbSchema.servers.type,
            stats: DbSchema.servers.stats,
            generation: DbSchema.servers.generation,
            heartbeatAt: DbSchema.servers.heartbeatAt,
            queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(DbSchema.servers.createdAt),
          })
          .from(DbSchema.servers)
          .orderBy(DbSchema.servers.type, DbSchema.servers.createdAt, DbSchema.servers.url),
      );
      return rows;
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

    // The rows of one kind whose servers stopped announcing themselves: ten minutes without a
    // heartbeat is twenty missed writes. The row goes; a server that does come back writes a new
    // one on its next heartbeat. A row nobody claimed counts from its creation, so an operator's
    // typo goes the same way. The urls deleted come back, one line each for whoever swept.
    const removeStaleServers = Effect.fn("db.removeStaleServers")(function* (type: ServerType) {
      const rows = yield* database.run("removeStaleServers", (db) =>
        db
          .delete(DbSchema.servers)
          .where(
            and(
              eq(DbSchema.servers.type, type),
              sql`coalesce(${DbSchema.servers.heartbeatAt}, ${DbSchema.servers.createdAt}) < now() - interval '10 minutes'`,
            ),
          )
          .returning({ url: DbSchema.servers.url }),
      );
      return rows.map((row) => row.url);
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
      listMachines,
      listLiveServers,
      removeStaleServers,
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
