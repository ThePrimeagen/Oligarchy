import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Redacted, Stdio } from "effect";
import * as Config from "../src/config.ts";
import { withProcessEnv } from "./process-env.ts";

const platform = Layer.mergeAll(FileSystem.layerNoop({}), Stdio.layerTest({}));

describe("Config.fromValues", () => {
  it.effect("answers the variables it was given and nothing else (happy)", () =>
    Effect.gen(function* () {
      expect(Redacted.value(yield* Config.databaseUrl)).toBe("postgres://local/oligarchy");
      const error = yield* Effect.flip(Config.linearTeam);
      expect(error).toMatchObject({ _tag: "MissingVariable", name: "LINEAR_TEAM" });
    }).pipe(Effect.provide(Config.fromValues({ DATABASE_URL: "postgres://local/oligarchy" }))),
  );

  it.effect("counts an empty string as absent, as fromEnv does (unhappy)", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.linearTeam);
      expect(error.message).toBe("LINEAR_TEAM is not set");
    }).pipe(Effect.provide(Config.fromValues({ LINEAR_TEAM: "" }))),
  );

  it("refuses a name that is not in the list (unhappy)", () => {
    // @ts-expect-error a misspelt variable does not compile: the list is the type.
    const layer = Config.fromValues({ DATABSE_URL: "postgres://local/oligarchy" });
    expect(layer).toBeDefined();
  });
});

describe("Config.override", () => {
  it.effect("answers the override for its name and the live chain for every other (happy)", () =>
    withProcessEnv(
      { DATABASE_URL: "postgres://process", LINEAR_TEAM: "Process Board" },
      Effect.gen(function* () {
        expect(Redacted.value(yield* Config.databaseUrl)).toBe("postgres://local/oligarchy");
        expect(yield* Config.linearTeam).toBe("Process Board");
      }).pipe(
        Effect.provide(
          Config.override({ DATABASE_URL: "postgres://local/oligarchy" }).pipe(
            Layer.provide(platform),
          ),
        ),
      ),
    ),
  );

  it.effect("an empty override is absent, so the chain answers (unhappy)", () =>
    withProcessEnv(
      { DATABASE_URL: "postgres://process" },
      Effect.gen(function* () {
        expect(Redacted.value(yield* Config.databaseUrl)).toBe("postgres://process");
      }).pipe(Effect.provide(Config.override({ DATABASE_URL: "" }).pipe(Layer.provide(platform)))),
    ),
  );

  it.effect(
    "a name neither the override nor the chain sets is still the chain's MissingVariable (unhappy)",
    () =>
      withProcessEnv(
        { LINEAR_TEAM: undefined },
        Effect.gen(function* () {
          const error = yield* Effect.flip(Config.linearTeam);
          expect(error).toMatchObject({
            _tag: "MissingVariable",
            name: "LINEAR_TEAM",
            message: "LINEAR_TEAM is not set",
          });
        }).pipe(
          Effect.provide(
            Config.override({ DATABASE_URL: "postgres://local/oligarchy" }).pipe(
              Layer.provide(platform),
            ),
          ),
        ),
      ),
  );
});
