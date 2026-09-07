import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import * as Config from "../config.ts";
import * as Render from "../observability/render.ts";
import * as Client from "./client.ts";

export const migrateDatabase = Effect.gen(function* () {
  const database = yield* Client.Database;
  yield* database.run("migrate", (db) => migrate(db, { migrationsFolder: "drizzle" }));
  yield* Console.log("database migrations applied");
});

export const program = Effect.gen(function* () {
  const url = yield* Config.databaseUrl;
  const database = yield* Client.Database.make(url);
  yield* migrateDatabase.pipe(Effect.provideService(Client.Database, database));
}).pipe(Effect.scoped);

if (import.meta.main) {
  const MainLive = Layer.provideMerge(Config.providerLayer, NodeServices.layer);
  NodeRuntime.runMain(
    Effect.gen(function* () {
      const services = yield* Layer.build(MainLive);
      yield* program.pipe(
        Effect.tapCause((cause) => Console.error(Render.renderFailure(cause))),
        Effect.provide(services),
      );
    }).pipe(Effect.scoped),
    { disableErrorReporting: true },
  );
}
