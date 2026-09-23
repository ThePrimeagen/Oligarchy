import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Inspectable, Layer, Redacted, Stdio } from "effect";
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
      expect(Redacted.value(yield* Config.databaseMigrationUrl)).toBe("g");
      expect(Redacted.value(yield* Config.linearApiToken)).toBe("c");
      expect(yield* Config.linearTeam).toBe("h");
      expect(Redacted.value(yield* Config.linearWebhookSecret)).toBe("f");
      expect(yield* Config.serverUrl).toBe("d");
      expect(yield* Config.sessionId).toBe("e");
    }).pipe(
      Effect.provide(
        Support.withEnv({
          OLIGARCHY_TOKEN: "a",
          DATABASE_URL: "b",
          DATABASE_MIGRATION_URL: "g",
          LINEAR_API_TOKEN: "c",
          LINEAR_TEAM: "h",
          LINEAR_WEBHOOK_SECRET: "f",
          SERVER_URL: "d",
          SESSION_ID: "e",
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

  // A flag fallback, like SERVER_URL: an empty SESSION_ID is unset, so the flag's own rule applies.
  it.effect("sessionId treats an empty SESSION_ID as unset", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.sessionId);
      expect(error._tag).toBe("ConfigError");
    }).pipe(Effect.provide(Support.withEnv({ SESSION_ID: "" }))),
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
  Layer.mergeAll(
    FileSystem.layerNoop({
      exists: (path) => Effect.succeed(path === ".env"),
      readFileString: (path) =>
        path === ".env"
          ? Effect.succeed(contents)
          : Effect.die(`unexpected readFileString ${path}`),
    }),
    Stdio.layerTest({}),
  );

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
      }).pipe(
        Effect.provide(
          Config.providerLayer.pipe(
            Layer.provide(Layer.mergeAll(FileSystem.layerNoop({}), Stdio.layerTest({}))),
          ),
        ),
      ),
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

const envFiles = (files: Record<string, string>) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(Object.hasOwn(files, path)),
    readFileString: (path) => {
      const contents = files[path];
      return contents === undefined
        ? Effect.die(`unexpected readFileString ${path}`)
        : Effect.succeed(contents);
    },
  });

const provideProvider = (args: ReadonlyArray<string>, files: Record<string, string>) =>
  Config.providerLayer.pipe(
    Layer.provide(Layer.mergeAll(envFiles(files), Stdio.layerTest({ args: Effect.succeed(args) }))),
  );

const readFill = Config.required("OLIGARCHY_TEST_FILL");

describe("providerLayer --env-file", () => {
  const dot =
    "OLIGARCHY_TEST_SET=from-dotenv\nOLIGARCHY_TEST_FILE=from-dotenv\nOLIGARCHY_TEST_DOT=from-dotenv\n";
  const extra =
    "OLIGARCHY_TEST_SET=from-file\nOLIGARCHY_TEST_FILE=from-file\nOLIGARCHY_TEST_LITERAL=to$ken\n";

  it.effect("lets the process environment win, then --env-file, then .env (happy)", () =>
    withProcessEnv(
      { OLIGARCHY_TEST_SET: "from-env" },
      Effect.gen(function* () {
        expect(yield* Config.required("OLIGARCHY_TEST_SET")).toBe("from-env");
        expect(yield* Config.required("OLIGARCHY_TEST_FILE")).toBe("from-file");
        expect(yield* Config.required("OLIGARCHY_TEST_DOT")).toBe("from-dotenv");
        expect(yield* Config.required("OLIGARCHY_TEST_LITERAL")).toBe("to$ken");
      }).pipe(
        Effect.provide(
          provideProvider(["--env-file", ".prod-env"], { ".env": dot, ".prod-env": extra }),
        ),
      ),
    ),
  );

  it.effect("reads --env-file=path the same way as the split flag (happy)", () =>
    Effect.gen(function* () {
      expect(yield* readFill).toBe("from-file");
    }).pipe(
      Effect.provide(
        provideProvider(["--env-file=.prod-env"], {
          ".prod-env": "OLIGARCHY_TEST_FILL=from-file\n",
        }),
      ),
    ),
  );

  it.effect("uses the last --env-file when the flag is repeated (happy)", () =>
    Effect.gen(function* () {
      expect(yield* readFill).toBe("second");
    }).pipe(
      Effect.provide(
        provideProvider(["--env-file", "first.env", "--env-file", "second.env"], {
          "first.env": "OLIGARCHY_TEST_FILL=first\n",
          "second.env": "OLIGARCHY_TEST_FILL=second\n",
        }),
      ),
    ),
  );

  it.effect("does not read --env-file after -- (unhappy)", () =>
    Effect.gen(function* () {
      expect(yield* readFill).toBe("from-dotenv");
    }).pipe(
      Effect.provide(
        provideProvider(["--", "--env-file", ".prod-env"], {
          ".env": "OLIGARCHY_TEST_FILL=from-dotenv\n",
          ".prod-env": "OLIGARCHY_TEST_FILL=from-file\n",
        }),
      ),
    ),
  );

  const failedRead = (args: ReadonlyArray<string>, files: Record<string, string>) =>
    Effect.exit(readFill.pipe(Effect.provide(provideProvider(args, files))));

  it.effect("fails when --env-file is passed without a path (unhappy)", () =>
    Effect.gen(function* () {
      const exit = yield* failedRead(["--env-file"], { ".env": "OLIGARCHY_TEST_FILL=1\n" });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("--env-file needs a path");
      }
    }),
  );

  it.effect("fails when --env-file= is empty (unhappy)", () =>
    Effect.gen(function* () {
      const exit = yield* failedRead(["--env-file="], {});
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("--env-file needs a path");
      }
    }),
  );

  it.effect("fails when the named file cannot be read (unhappy)", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        readFill.pipe(
          Effect.provide(
            Config.providerLayer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  FileSystem.layerNoop({}),
                  Stdio.layerTest({ args: Effect.succeed(["--env-file", ".prod-env"]) }),
                ),
              ),
            ),
          ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain(".prod-env");
      }
    }),
  );
});

describe("linearTeam", () => {
  it.effect("returns the team name when set", () =>
    Effect.gen(function* () {
      expect(yield* Config.linearTeam).toBe("Local Board");
    }).pipe(Effect.provide(Support.withEnv({ LINEAR_TEAM: "Local Board" }))),
  );

  it.effect("fails MissingVariable rendered LINEAR_TEAM is not set when missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.linearTeam);
      expect(error).toMatchObject({
        _tag: "MissingVariable",
        name: "LINEAR_TEAM",
        message: "LINEAR_TEAM is not set",
      });
    }).pipe(Effect.provide(Support.withEnv({}))),
  );

  it.effect("treats an empty value as missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.linearTeam);
      expect(error).toMatchObject({ _tag: "MissingVariable", name: "LINEAR_TEAM" });
    }).pipe(Effect.provide(Support.withEnv({ LINEAR_TEAM: "" }))),
  );

  // The token is the credential; the team is which board that credential files on.
  it.effect("reports LINEAR_API_TOKEN before LINEAR_TEAM when both are missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.linearAccess);
      expect(error.message).toBe("LINEAR_API_TOKEN is not set");
    }).pipe(Effect.provide(Support.withEnv({}))),
  );

  it.effect("reports LINEAR_TEAM when the token is set and the team is not", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.linearAccess);
      expect(error.message).toBe("LINEAR_TEAM is not set");
    }).pipe(Effect.provide(Support.withEnv({ LINEAR_API_TOKEN: "lin" }))),
  );

  it.effect("holds the token and the team name", () =>
    Effect.gen(function* () {
      const access = yield* Config.linearAccess;
      expect(Redacted.value(access.token)).toBe("lin");
      expect(access.team).toBe("Local Board");
    }).pipe(
      Effect.provide(Support.withEnv({ LINEAR_API_TOKEN: "lin", LINEAR_TEAM: "Local Board" })),
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
