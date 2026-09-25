import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Console, Effect, Layer } from "effect";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Render from "@oligarchy/log/render";
import * as Client from "./client.ts";

export const migrateDatabase = Effect.gen(function* () {
  const database = yield* Client.Database;
  yield* database.run("migrate", (db) => migrate(db, { migrationsFolder: "drizzle" }));
  yield* Console.log("database migrations applied");
});

export const program = Effect.gen(function* () {
  const url = yield* Config.databaseMigrationUrl;
  const database = yield* Client.Database.make(url);
  yield* migrateDatabase.pipe(Effect.provideService(Client.Database, database));
}).pipe(Effect.scoped);

// Not a Command, so not Env.program: the one entry that is a bare effect, still run by the runner.
// The print sits outside the environment, so an unreadable `.env` prints its cause too.
if (import.meta.main) {
  Env.run(
    Effect.gen(function* () {
      const services = yield* Layer.build(Config.live);
      yield* program.pipe(Effect.provide(services));
    }).pipe(Effect.scoped, Effect.tapCause(Render.reportFailure)),
  );
}
