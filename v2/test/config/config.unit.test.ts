import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, FileSystem, Inspectable, Layer, Redacted } from "effect";
import * as Config from "../../src/config.ts";
import * as Support from "../support/config.ts";

const SENTINEL = "s3cr3t-sentinel-value";

describe("required", () => {
  it.effect("returns the value when set", () =>
    Effect.gen(function* () {
      const value = yield* Config.required("OLIGARCHY_TOKEN");
      expect(value).toBe("t0ken");
    }).pipe(Effect.provide(Support.withEnv({ OLIGARCHY_TOKEN: "t0ken" }))),
  );

  it.effect("fails MissingVariable rendered <NAME> is not set when missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.required("OLIGARCHY_TOKEN"));
      expect(error._tag).toBe("MissingVariable");
      expect(error.message).toBe("OLIGARCHY_TOKEN is not set");
    }).pipe(Effect.provide(Support.withEnv({}))),
  );

  it.effect("treats an empty value as missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.required("OLIGARCHY_TOKEN"));
      expect(error).toMatchObject({ _tag: "MissingVariable", name: "OLIGARCHY_TOKEN" });
    }).pipe(Effect.provide(Support.withEnv({ OLIGARCHY_TOKEN: "" }))),
  );
});

describe("requiredRedacted", () => {
  it.effect("wraps the value so it never prints", () =>
    Effect.gen(function* () {
      const token = yield* Config.requiredRedacted("OLIGARCHY_TOKEN");
      expect(Redacted.value(token)).toBe(SENTINEL);
      expect(Inspectable.toStringUnknown(token)).not.toContain(SENTINEL);
      expect(JSON.stringify(token)).not.toContain(SENTINEL);
      expect(Cause.pretty(Cause.fail(token))).not.toContain(SENTINEL);
      expect(Cause.pretty(Cause.die(token))).not.toContain(SENTINEL);
    }).pipe(Effect.provide(Support.withEnv({ OLIGARCHY_TOKEN: SENTINEL }))),
  );

  it.effect("treats an empty value as missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.requiredRedacted("DATABASE_URL"));
      expect(error.message).toBe("DATABASE_URL is not set");
    }).pipe(Effect.provide(Support.withEnv({ DATABASE_URL: "" }))),
  );

  it.effect("the named accessors read their variables", () =>
    Effect.gen(function* () {
      expect(Redacted.value(yield* Config.oligarchyToken)).toBe("a");
      expect(Redacted.value(yield* Config.databaseUrl)).toBe("b");
      expect(Redacted.value(yield* Config.linearApiToken)).toBe("c");
      expect(Redacted.value(yield* Config.cursorApiToken)).toBe("d");
      expect(yield* Config.serverUrl).toBe("e");
    }).pipe(
      Effect.provide(
        Support.withEnv({
          OLIGARCHY_TOKEN: "a",
          DATABASE_URL: "b",
          LINEAR_API_TOKEN: "c",
          CURSOR_API_TOKEN: "d",
          SERVER_URL: "e",
        }),
      ),
    ),
  );

  it.effect("serverUrl treats an empty SERVER_URL as unset", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.serverUrl);
      expect(error._tag).toBe("ConfigError");
      expect(Config.DEFAULT_SERVER_URL).toBe("http://127.0.0.1:42069");
    }).pipe(Effect.provide(Support.withEnv({ SERVER_URL: "" }))),
  );
});

const withProcessEnv = <A, E, R>(
  values: Record<string, string>,
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      for (const [key, value] of Object.entries(values)) {
        process.env[key] = value;
      }
    }),
    () => self,
    () =>
      Effect.sync(() => {
        for (const key of Object.keys(values)) {
          delete process.env[key];
        }
      }),
  );

const dotEnvFileSystem = (contents: string) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path === ".env"),
    readFileString: (path) =>
      path === ".env" ? Effect.succeed(contents) : Effect.die(`unexpected readFileString ${path}`),
  });

describe("providerLayer", () => {
  it.effect("fills missing variables from .env in the working directory", () =>
    withProcessEnv(
      { OLIGARCHY_TEST_SET: "from-env" },
      Effect.gen(function* () {
        expect(yield* Config.required("OLIGARCHY_TEST_SET")).toBe("from-env");
        expect(yield* Config.required("OLIGARCHY_TEST_FILL")).toBe("from-dotenv");
      }).pipe(
        Effect.provide(
          Config.providerLayer.pipe(
            Layer.provide(
              dotEnvFileSystem("OLIGARCHY_TEST_SET=from-dotenv\nOLIGARCHY_TEST_FILL=from-dotenv\n"),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("reads the environment alone when .env is absent", () =>
    withProcessEnv(
      { OLIGARCHY_TEST_SET: "from-env" },
      Effect.gen(function* () {
        expect(yield* Config.required("OLIGARCHY_TEST_SET")).toBe("from-env");
        const error = yield* Effect.flip(Config.required("OLIGARCHY_TEST_FILL"));
        expect(error.message).toBe("OLIGARCHY_TEST_FILL is not set");
      }).pipe(Effect.provide(Config.providerLayer.pipe(Layer.provide(FileSystem.layerNoop({}))))),
    ),
  );

  it.effect("still reports a variable neither source has", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.required("OLIGARCHY_TEST_NOWHERE"));
      expect(error.message).toBe("OLIGARCHY_TEST_NOWHERE is not set");
    }).pipe(
      Effect.provide(
        Config.providerLayer.pipe(Layer.provide(dotEnvFileSystem("OLIGARCHY_TEST_OTHER=1\n"))),
      ),
    ),
  );
});

describe("ProxyConfig", () => {
  it.effect("holds both secrets", () =>
    Effect.gen(function* () {
      const config = yield* Config.ProxyConfig;
      expect(Redacted.value(config.token)).toBe("t");
      expect(Redacted.value(config.databaseUrl)).toBe("postgres://x");
    }).pipe(
      Effect.provide(
        Config.ProxyConfig.layer.pipe(
          Layer.provide(Support.withEnv({ OLIGARCHY_TOKEN: "t", DATABASE_URL: "postgres://x" })),
        ),
      ),
    ),
  );

  it.effect("reports OLIGARCHY_TOKEN before DATABASE_URL when both are missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.ProxyConfig.make);
      expect(error.message).toBe("OLIGARCHY_TOKEN is not set");
    }).pipe(Effect.provide(Support.withEnv({}))),
  );

  it.effect("reports DATABASE_URL when only the token is set", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.ProxyConfig.make);
      expect(error.message).toBe("DATABASE_URL is not set");
    }).pipe(Effect.provide(Support.withEnv({ OLIGARCHY_TOKEN: "t" }))),
  );
});
