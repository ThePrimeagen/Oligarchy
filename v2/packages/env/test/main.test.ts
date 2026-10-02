import { readFileSync } from "node:fs";
import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Env from "../src/main.ts";

const SENTINEL = "s3cr3t-sentinel-value";
const DATABASE_URL = `postgres://oligarchy:${SENTINEL}@db.example:5432/oligarchy`;
const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");
const ISO = "https://example.com/omarchy.iso";

// Every create reads oligarchy.json, so every fake carries the checked-in one unless a test says otherwise.
const io = (options: {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
}) => Env.fakeIo({ ...options, files: { [Env.CONFIG_PATH]: CONFIG, ...options.files } });

const ctrl = Env.cli({ name: "ctrl", description: "Record and inspect test runs" })
  .flags({
    serverUrl: Env.args.serverUrl(false),
    sessionId: Env.args.sessionId(false),
    count: Env.args.count(false),
  })
  .needs("databaseUrl")
  .command("setup", "Set the ISO up on every live qemu server")
  .flags({ iso: Env.args.iso(), setupOnly: Env.args.setupOnly(false) })
  .needs("oligarchyToken", "automationServerUrl")
  .done()
  .command("test", "Test definitions and their runs")
  .command("run", "File a test suite and its jobs")
  .flags({ iso: Env.args.iso() })
  .command("one", "File a run of one definition")
  .flags({ name: Env.args.definitionName() })
  .done()
  .done()
  .done()
  .done();

const RUN_ONE = ["test", "run", "one", "--name", "lock-screen", "--iso", ISO];

describe("create", () => {
  it("runs the command the words name, with its own flags and every one above it (happy)", async () => {
    const result = await Env.create(
      ctrl,
      io({ argv: [...RUN_ONE, "--session-id", "s-1"], env: { DATABASE_URL } }),
    );
    const env = jarl.unwrap(result);
    expectTypeOf(env.command).toEqualTypeOf<"setup" | "test run one">();
    if (env.command !== "test run one") {
      throw new Error(`expected test run one, got ${env.command}`);
    }
    expectTypeOf(env.flags).toEqualTypeOf<{
      serverUrl: string | undefined;
      sessionId: string | undefined;
      count: number;
      iso: string;
      name: string;
    }>();
    expectTypeOf(env.vars).toEqualTypeOf<{ databaseUrl: Env.Secret }>();
    expect(env.flags).toEqual({
      serverUrl: undefined,
      sessionId: "s-1",
      count: 10,
      iso: ISO,
      name: "lock-screen",
    });
    expect(env.vars.databaseUrl.reveal()).toBe(DATABASE_URL);
    expect(JSON.stringify(env)).not.toContain(SENTINEL);
  });

  it("refuses a command whose needed variable is unset (unhappy)", async () => {
    const result = await Env.create(
      ctrl,
      io({
        argv: ["setup", "--iso", ISO],
        env: { DATABASE_URL, AUTOMATION_SERVER_URL: "http://automation" },
      }),
    );
    if (!jarl.error.is(result, Env.MissingVariable)) {
      throw new Error("expected MissingVariable");
    }
    expect(result.error.message).toBe("OLIGARCHY_TOKEN is not set");
  });

  it("refuses a DATABASE_URL that is not a url, naming the variable and never its value (unhappy)", async () => {
    for (const value of [SENTINEL, `postgres://oligarchy:${SENTINEL}@db.example:port/x`]) {
      const result = await Env.create(ctrl, io({ argv: RUN_ONE, env: { DATABASE_URL: value } }));
      if (!jarl.error.is(result, Env.InvalidVariable)) {
        throw new Error("expected InvalidVariable");
      }
      expect(result.error.variable).toBe("DATABASE_URL");
      expect(result.error.message).toBe("DATABASE_URL is not a url");
      expect(result.error.cause).toBeUndefined();
      expect(JSON.stringify(result.error)).not.toContain(SENTINEL);
      expect(String(result.error.stack)).not.toContain(SENTINEL);
    }
  });

  it("refuses a command whose required flag is not given (unhappy)", async () => {
    const withoutName = RUN_ONE.filter((arg) => arg !== "--name" && arg !== "lock-screen");
    const result = await Env.create(ctrl, io({ argv: withoutName, env: { DATABASE_URL } }));
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("--name is required");
  });

  it("layers the process environment over --env-file over .env, flags' variables too (happy)", async () => {
    const result = await Env.create(
      ctrl,
      io({
        argv: ["setup", "--iso", ISO, "--setup-only", "--env-file", ".prod-env"],
        env: { AUTOMATION_SERVER_URL: "from-env" },
        files: {
          ".prod-env":
            "AUTOMATION_SERVER_URL=from-file\nOLIGARCHY_TOKEN=from-file\nSESSION_ID=from-file\n",
          ".env":
            "AUTOMATION_SERVER_URL=from-dot\nOLIGARCHY_TOKEN=from-dot\nDATABASE_URL=postgres://from-dot@db.example/oligarchy\n",
        },
      }),
    );
    const env = jarl.unwrap(result);
    if (env.command !== "setup") {
      throw new Error(`expected setup, got ${env.command}`);
    }
    expect(env.flags.setupOnly).toBe(true);
    expect(env.vars.automationServerUrl).toBe("from-env");
    expect(env.vars.oligarchyToken.reveal()).toBe("from-file");
    expect(env.vars.databaseUrl.reveal()).toBe("postgres://from-dot@db.example/oligarchy");
    expect(env.flags.sessionId).toBe("from-file");
  });

  it("hands the program oligarchy.json as the file says it (happy)", async () => {
    const file = {
      ...JSON.parse(CONFIG),
      models: { drive: "test/drive", diagnose: "test/diagnose", setup: "test/setup" },
      stepLimit: 7,
      timeouts: { header: "2 seconds", chunk: "5 seconds" },
    };
    const result = await Env.create(
      ctrl,
      io({
        argv: RUN_ONE,
        env: { DATABASE_URL },
        files: { [Env.CONFIG_PATH]: JSON.stringify(file) },
      }),
    );
    const { config } = jarl.unwrap(result);
    expect(config.models).toEqual(file.models);
    expect(config.stepLimit).toBe(7);
    expect(config.timeouts).toEqual({ header: 2_000, chunk: 5_000 });
  });
});

describe("declared", () => {
  it("has no Linear variable a command can need (unhappy)", () => {
    expectTypeOf<Extract<Env.Name, `linear${string}`>>().toBeNever();
  });

  it("has no --version flag, the Linear ticket label (unhappy)", () => {
    expectTypeOf(Env.args).not.toHaveProperty("version");
    expect(Object.keys(Env.args)).not.toContain("version");
  });
});
