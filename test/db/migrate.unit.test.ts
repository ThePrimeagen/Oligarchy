import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as Config from "@oligarchy/env/config";
import * as Migrate from "../../src/db/migrate.ts";

const APP_URL = "postgres://user:pw@127.0.0.1:1/oligarchy";

describe("migrate program", () => {
  it.effect("does not fall back to DATABASE_URL when the migration url is empty (unhappy)", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Migrate.program);
      expect(error.message).toBe("DATABASE_MIGRATION_URL is not set");
    }).pipe(
      Effect.provide(Config.fromValues({ DATABASE_MIGRATION_URL: "", DATABASE_URL: APP_URL })),
    ),
  );

  it.effect("an invalid DATABASE_MIGRATION_URL fails as a database url (unhappy)", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Migrate.program);
      expect(error.message).toBe("db: database url is not a valid url");
    }).pipe(
      Effect.provide(
        Config.fromValues({ DATABASE_MIGRATION_URL: "not a url", DATABASE_URL: APP_URL }),
      ),
    ),
  );
});
