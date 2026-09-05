import { describe, inject } from "vitest";
import { Layer, Redacted } from "effect";
import * as Actions from "../../src/db/actions.ts";
import * as Client from "../../src/db/client.ts";
import * as Logs from "../../src/db/logs.ts";
import * as Sessions from "../../src/db/sessions.ts";
import * as Tests from "../../src/db/tests.ts";

// The Testcontainers database started by vitest.global-setup.ts; "" when Docker is absent.
export const getDbUrl = (): string => inject("dbUrl");

// `describe` when a database is available, `describe.skip` otherwise.
export const describeWithDatabase = getDbUrl().length > 0 ? describe : describe.skip;

export const DatabaseLive = (url: string): Layer.Layer<Client.Database> =>
  Client.Database.layer(Redacted.make(url)).pipe(Layer.orDie);

// Every repository over the migrated container database.
export const migratedLayer: Layer.Layer<
  Client.Database | Sessions.SessionStore | Actions.ActionStore | Logs.LogStore | Tests.TestStore
> = Layer.mergeAll(
  Sessions.SessionStore.layer,
  Actions.ActionStore.layer,
  Logs.LogStore.layer,
  Tests.TestStore.layer,
).pipe(Layer.provideMerge(DatabaseLive(getDbUrl())));
