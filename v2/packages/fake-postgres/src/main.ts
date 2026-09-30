import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import * as jarl from "jarl";
import * as Template from "./template.ts";

export const FakePostgresError = jarl.error.define("FakePostgresError");
export type FakePostgresError = InstanceType<typeof FakePostgresError>;

export type FakePostgres = {
  readonly url: string;
  readonly stop: () => Promise<void>;
};

const HOST = "127.0.0.1";

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

const refused = (message: string, cause: unknown): FakePostgresError => {
  const error = new FakePostgresError(`${message}: ${messageOf(cause)}`);
  error.cause = cause;
  return error;
};

// For tests only: the one real thing a test may start. An in-memory Postgres (PGlite) with v2's
// migrations applied, speaking the wire protocol on HOST so node-postgres reaches it like any
// other database. Each start is a fresh, empty database on a free port unless one is named; the
// url says which. Stopping it drops every connection, as a database shutting down does.
export const start = async (
  options: { readonly port?: number } = {},
): Promise<jarl.Result<FakePostgres, FakePostgresError>> => {
  const port = options.port ?? 0;
  const data = await jarl.exec(Template.migrated, (thrown) =>
    refused("fake-postgres: could not prepare the migrated database", thrown),
  );
  if (jarl.is_err(data)) {
    return data;
  }
  const pg = new PGlite({ loadDataDir: jarl.value(data) });
  const loaded = await jarl.exec(
    () => pg.waitReady,
    (thrown) => refused("fake-postgres: could not load the migrated database", thrown),
  );
  if (jarl.is_err(loaded)) {
    await pg.close();
    return loaded;
  }
  // node-postgres's pool opens up to ten connections; PGlite runs their queries one at a time.
  const server = new PGLiteSocketServer({
    db: pg,
    host: HOST,
    port,
    maxConnections: 10,
  });
  const listening = await jarl.exec(
    () => server.start(),
    (thrown) => refused(`fake-postgres: could not listen on ${HOST}:${String(port)}`, thrown),
  );
  if (jarl.is_err(listening)) {
    await pg.close();
    return listening;
  }
  let stopped: Promise<void> | undefined;
  return jarl.ok({
    url: `postgres://postgres@${server.getServerConn()}/postgres`,
    // A test may stop it to see what a shutdown does, and its cleanup stops it again.
    stop: () =>
      (stopped ??= (async () => {
        try {
          await server.stop();
        } finally {
          await pg.close();
        }
      })()),
  });
};
