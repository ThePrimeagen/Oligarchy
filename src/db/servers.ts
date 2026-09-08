import { eq } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export class ServerStore extends Context.Service<ServerStore>()("@oligarchy/db/ServerStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    // Registering a url twice is one row: the probe already said the server is there.
    const addServer = Effect.fn("db.addServer")(function* (url: string) {
      yield* database.run("addServer", (db) =>
        db.insert(DbSchema.servers).values({ url }).onConflictDoNothing(),
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

    // Registration order, so a placement tie goes to the server that was there first.
    const listServers = Effect.fn("db.listServers")(function* () {
      const rows = yield* database.run("listServers", (db) =>
        db
          .select({ url: DbSchema.servers.url })
          .from(DbSchema.servers)
          .orderBy(DbSchema.servers.createdAt, DbSchema.servers.url),
      );
      return rows.map((row) => row.url);
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

    return { addServer, removeServer, listServers, routeSession, serverForSession };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
