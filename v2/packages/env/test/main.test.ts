import { readFileSync } from "node:fs";
import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Env from "../src/main.ts";

const SENTINEL = "s3cr3t-sentinel-value";
const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");
const ISO = "https://example.com/omarchy.iso";

// Every create reads oligarchy.json, so every fake carries the checked-in one unless a test says otherwise.
const io = (options: {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
}) => Env.fakeIo({ ...options, files: { [Env.CONFIG_PATH]: CONFIG, ...options.files } });

const ctrl = Env.cli({ name: "ctrl", description: "Record and inspect test runs" })
  .flags({ serverUrl: Env.args.serverUrl(false), sessionId: Env.args.sessionId(false) })
  .needs("databaseUrl")
  .command("mint", "Mint the ISO on every live qemu server")
  .flags({ iso: Env.args.iso(), unminted: Env.args.unminted(false) })
  .needs("linearApiToken", "linearTeam")
  .done()
  .command("test", "Test definitions and their runs")
  .command("run", "File runs and their Linear tickets")
  .flags({ iso: Env.args.iso(), version: Env.args.version() })
  .command("one", "File a run of one definition")
  .flags({ name: Env.args.definitionName() })
  .done()
  .done()
  .done()
  .done();

const RUN_ONE = [
  "test",
  "run",
  "one",
  "--name",
  "lock-screen",
  "--iso",
  ISO,
  "--version",
  "2026.09.1",
];

describe("create", () => {
  it("runs the command the words name, with its own flags and every one above it (happy)", async () => {
    const result = await Env.create(
      ctrl,
      io({ argv: [...RUN_ONE, "--session-id", "s-1"], env: { DATABASE_URL: SENTINEL } }),
    );
    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    const env = result.value;
    expectTypeOf(env.command).toEqualTypeOf<"mint" | "test run one">();
    if (env.command !== "test run one") {
      throw new Error(`expected test run one, got ${env.command}`);
    }
    expectTypeOf(env.flags).toEqualTypeOf<{
      serverUrl: string;
      sessionId: string | undefined;
      iso: string;
      version: string;
      name: string;
    }>();
    expectTypeOf(env.vars).toEqualTypeOf<{ databaseUrl: Env.Secret }>();
    expect(env.flags).toEqual({
      serverUrl: "http://127.0.0.1:42069",
      sessionId: "s-1",
      iso: ISO,
      version: "2026.09.1",
      name: "lock-screen",
    });
    expect(env.vars.databaseUrl.reveal()).toBe(SENTINEL);
    expect(JSON.stringify(env)).not.toContain(SENTINEL);
  });

  it("refuses a command whose needed variable is unset (unhappy)", async () => {
    const result = await Env.create(
      ctrl,
      io({ argv: ["mint", "--iso", ISO], env: { DATABASE_URL: SENTINEL, LINEAR_TEAM: "Board" } }),
    );
    if (!jarl.error.is(result, Env.MissingVariable)) {
      throw new Error("expected MissingVariable");
    }
    expect(result.error.message).toBe("LINEAR_API_TOKEN is not set");
  });

  it("refuses a command whose required flag is not given (unhappy)", async () => {
    const withoutName = RUN_ONE.filter((arg) => arg !== "--name" && arg !== "lock-screen");
    const result = await Env.create(
      ctrl,
      io({ argv: withoutName, env: { DATABASE_URL: SENTINEL } }),
    );
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("--name is required");
  });

  it("layers the process environment over --env-file over .env, flags' variables too (happy)", async () => {
    const result = await Env.create(
      ctrl,
      io({
        argv: ["mint", "--iso", ISO, "--env-file", ".prod-env"],
        env: { LINEAR_TEAM: "from-env" },
        files: {
          ".prod-env": "LINEAR_TEAM=from-file\nLINEAR_API_TOKEN=from-file\nSESSION_ID=from-file\n",
          ".env": "LINEAR_TEAM=from-dot\nLINEAR_API_TOKEN=from-dot\nDATABASE_URL=from-dot\n",
        },
      }),
    );
    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    const env = result.value;
    if (env.command !== "mint") {
      throw new Error(`expected mint, got ${env.command}`);
    }
    expect(env.vars.linearTeam).toBe("from-env");
    expect(env.vars.linearApiToken.reveal()).toBe("from-file");
    expect(env.vars.databaseUrl.reveal()).toBe("from-dot");
    expect(env.flags.sessionId).toBe("from-file");
  });

  it("hands the program oligarchy.json as the file says it (happy)", async () => {
    const file = {
      ...JSON.parse(CONFIG),
      models: { drive: "test/drive", diagnose: "test/diagnose", mint: "test/mint" },
      stepLimit: 7,
      timeouts: { header: "2 seconds", chunk: "5 seconds" },
    };
    const result = await Env.create(
      ctrl,
      io({
        argv: RUN_ONE,
        env: { DATABASE_URL: SENTINEL },
        files: { [Env.CONFIG_PATH]: JSON.stringify(file) },
      }),
    );
    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    expect(result.value.config.models).toEqual(file.models);
    expect(result.value.config.stepLimit).toBe(7);
    expect(result.value.config.timeouts).toEqual({ header: 2_000, chunk: 5_000 });
  });
});
