import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Answer } from "./answer.ts";

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

export type Servers = {
  readonly service: "servers";
  readonly addServer: (url: string, type: ServerType) => Answer<void>;
  readonly heartbeat: (
    url: string,
    type: ServerType,
    name: string,
    stats: DbSchema.ServerStats,
  ) => Answer<void>;
  readonly removeServer: (url: string) => Answer<boolean>;
  readonly listServers: (type: ServerType) => Answer<ReadonlyArray<string>>;
  readonly listMachines: () => Answer<ReadonlyArray<Machine>>;
  readonly listLiveServers: (type: ServerType) => Answer<ReadonlyArray<LiveServer>>;
  // Deletes silent servers and, for QEMU runners, their job assignments atomically.
  readonly removeStaleServers: (
    type: ServerType,
    silentFor: number,
  ) => Answer<ReadonlyArray<string>>;
  readonly findServer: (id: string) => Answer<LiveServer | undefined>;
  readonly routeJob: (jobId: string, url: string) => Answer<void>;
  readonly serverForJob: (jobId: string) => Answer<string | undefined>;
};

declare module "@oligarchy/app" {
  interface Services {
    servers: App.Register<"servers", Servers>;
  }
}

export const create = App.createService<Db.Database, App.NoOptions, Servers>(({ db }) => ({
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
    db.run((d) =>
      d.transaction(async (tx) => {
        const rows = await tx
          .delete(DbSchema.servers)
          .where(eq(DbSchema.servers.url, url))
          .returning({ type: DbSchema.servers.type });
        if (rows[0]?.type === "qemu") {
          await tx.delete(DbSchema.jobServers).where(eq(DbSchema.jobServers.serverUrl, url));
        }
        return rows.length > 0;
      }),
    ),

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

  removeStaleServers: (type, silentFor) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const rows = await tx
          .delete(DbSchema.servers)
          .where(
            and(
              eq(DbSchema.servers.type, type),
              sql`coalesce(${DbSchema.servers.heartbeatAt}, ${DbSchema.servers.createdAt}) <= now() - ${silentFor}::double precision * interval '1 millisecond'`,
            ),
          )
          .returning({ url: DbSchema.servers.url });
        const urls = rows.map((row) => row.url);
        if (type === "qemu" && urls.length > 0) {
          await tx.delete(DbSchema.jobServers).where(inArray(DbSchema.jobServers.serverUrl, urls));
        }
        return urls;
      }),
    ),

  findServer: (id) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ id: DbSchema.servers.id, url: DbSchema.servers.url })
        .from(DbSchema.servers)
        .where(eq(DbSchema.servers.id, id));
      return row;
    }),

  routeJob: (jobId, url) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        // Removal locks this same row before deleting its assignments. A late reservation
        // cannot recreate an assignment after cleanup has committed.
        const [runner] = await tx
          .select({ url: DbSchema.servers.url })
          .from(DbSchema.servers)
          .where(and(eq(DbSchema.servers.url, url), eq(DbSchema.servers.type, "qemu")))
          .for("share");
        if (runner === undefined)
          throw new Error(`routeJob: runner ${url} is no longer registered`);
        await tx.insert(DbSchema.jobServers).values({ jobId, serverUrl: url });
      }),
    ),

  serverForJob: (jobId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ serverUrl: DbSchema.jobServers.serverUrl })
        .from(DbSchema.jobServers)
        .where(eq(DbSchema.jobServers.jobId, jobId));
      return row?.serverUrl;
    }),
}));
