import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type * as jarl from "jarl";

// A qemu server boots guests; an automation-client is a host that announces itself the same way.
export type ServerType = (typeof DbSchema.serverType.enumValues)[number];

export type LiveServer = { readonly id: string; readonly url: string };

// One machine of either kind with what it last said of itself, and the database's clock at the
// read, so a heartbeat's age is measured against the clock that stamped it. stats and
// heartbeatAt are null together, for a row an operator added that no server has claimed.
export type Machine = {
  readonly url: string;
  readonly name: string | null;
  readonly type: ServerType;
  readonly stats: DbSchema.ServerStats | null;
  readonly generation: number;
  readonly heartbeatAt: Date | null;
  readonly queriedAt: Date;
};

type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;

export type Servers = {
  readonly service: "servers";
  // Registering a url twice is one row: the probe already said the server is there.
  readonly addServer: (url: string, type: ServerType) => Answer<void>;
  // A server's own word on itself: its row comes into being on the first heartbeat or is
  // rewritten, generation counting every write, stamped by the database's clock. A name is one
  // machine's: a second url under it is refused.
  readonly heartbeat: (
    url: string,
    type: ServerType,
    name: string,
    stats: DbSchema.ServerStats,
  ) => Answer<void>;
  // false when nothing was registered under the url.
  readonly removeServer: (url: string) => Answer<boolean>;
  // One kind in registration order, so a placement tie goes to the server that was there first.
  readonly listServers: (type: ServerType) => Answer<ReadonlyArray<string>>;
  // Every machine: the qemu servers before the automation clients, as the enum declares the
  // kinds, each kind in registration order.
  readonly listMachines: () => Answer<ReadonlyArray<Machine>>;
  // One kind heard from in the last 45 seconds: a beat every 30, one missed and a little.
  readonly listLiveServers: (type: ServerType) => Answer<ReadonlyArray<LiveServer>>;
  // Forgets the rows of one kind ten minutes silent, twenty missed beats; a row nobody claimed
  // counts from its registration. The urls forgotten come back.
  readonly removeStaleServers: (type: ServerType) => Answer<ReadonlyArray<string>>;
  readonly findServer: (id: string) => Answer<LiveServer | undefined>;
  // A session is routed once: a second route, or one for a session that does not exist, is a
  // DatabaseError.
  readonly routeSession: (sessionId: string, url: string) => Answer<void>;
  readonly serverForSession: (sessionId: string) => Answer<string | undefined>;
  // One route per agent: a racing second keeps the first server.
  readonly routeAgent: (agentId: string, url: string) => Answer<void>;
  readonly serverForAgent: (agentId: string) => Answer<string | undefined>;
  // Start consumed the reservation; the next route may place again.
  readonly clearAgent: (agentId: string) => Answer<void>;
};

declare module "@oligarchy/app" {
  interface Services {
    servers: App.Register<"servers", Servers>;
  }
}

export const create = (db: Db.Database): Servers => ({
  service: "servers",

  addServer: (url, type) =>
    db.run(async (d) => {
      await d.insert(DbSchema.servers).values({ url, type }).onConflictDoNothing();
    }),

  heartbeat: (url, type, name, stats) =>
    db.run(async (d) => {
      const now = sql`now()`;
      await d
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
        });
    }),

  removeServer: (url) =>
    db.run(async (d) => {
      const rows = await d
        .delete(DbSchema.servers)
        .where(eq(DbSchema.servers.url, url))
        .returning({ url: DbSchema.servers.url });
      return rows.length > 0;
    }),

  listServers: (type) =>
    db.run(async (d) => {
      const rows = await d
        .select({ url: DbSchema.servers.url })
        .from(DbSchema.servers)
        .where(eq(DbSchema.servers.type, type))
        .orderBy(DbSchema.servers.createdAt, DbSchema.servers.url);
      return rows.map((row) => row.url);
    }),

  listMachines: () =>
    db.run((d) =>
      d
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
    ),

  listLiveServers: (type) =>
    db.run((d) =>
      d
        .select({ id: DbSchema.servers.id, url: DbSchema.servers.url })
        .from(DbSchema.servers)
        .where(
          and(
            eq(DbSchema.servers.type, type),
            sql`${DbSchema.servers.heartbeatAt} > now() - interval '45 seconds'`,
          ),
        )
        .orderBy(DbSchema.servers.createdAt, DbSchema.servers.url),
    ),

  removeStaleServers: (type) =>
    db.run(async (d) => {
      const rows = await d
        .delete(DbSchema.servers)
        .where(
          and(
            eq(DbSchema.servers.type, type),
            sql`coalesce(${DbSchema.servers.heartbeatAt}, ${DbSchema.servers.createdAt}) < now() - interval '10 minutes'`,
          ),
        )
        .returning({ url: DbSchema.servers.url });
      return rows.map((row) => row.url);
    }),

  findServer: (id) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ id: DbSchema.servers.id, url: DbSchema.servers.url })
        .from(DbSchema.servers)
        .where(eq(DbSchema.servers.id, id));
      return row;
    }),

  routeSession: (sessionId, url) =>
    db.run(async (d) => {
      await d.insert(DbSchema.sessionServers).values({ sessionId, serverUrl: url });
    }),

  serverForSession: (sessionId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ serverUrl: DbSchema.sessionServers.serverUrl })
        .from(DbSchema.sessionServers)
        .where(eq(DbSchema.sessionServers.sessionId, sessionId));
      return row?.serverUrl;
    }),

  routeAgent: (agentId, url) =>
    db.run(async (d) => {
      await d
        .insert(DbSchema.agentServers)
        .values({ agentId, serverUrl: url })
        .onConflictDoNothing();
    }),

  serverForAgent: (agentId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ serverUrl: DbSchema.agentServers.serverUrl })
        .from(DbSchema.agentServers)
        .where(eq(DbSchema.agentServers.agentId, agentId));
      return row?.serverUrl;
    }),

  clearAgent: (agentId) =>
    db.run(async (d) => {
      await d.delete(DbSchema.agentServers).where(eq(DbSchema.agentServers.agentId, agentId));
    }),
});
