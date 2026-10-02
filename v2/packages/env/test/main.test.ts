import { readFileSync } from "node:fs";
import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Env from "../src/main.ts";

const SENTINEL = "s3cr3t-sentinel-value";
const DATABASE_URL = `postgres://oligarchy:${SENTINEL}@db.example:5432/oligarchy`;
const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");
const PROXY = "http://proxy.example:42069";

// Every create reads oligarchy.json, so every fake carries the checked-in one unless a test says otherwise.
const io = (options: {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
}) => Env.fakeIo({ ...options, files: { [Env.CONFIG_PATH]: CONFIG, ...options.files } });

// A program of the real flags, nested as deep as a command line goes.
const program = Env.cli({ name: "fleet", description: "Run a machine of the fleet" })
  .flags({
    serverUrl: Env.args.serverUrl(false),
    dataDir: Env.args.dataDir(false),
    automation: Env.args.automation(false),
  })
  .needs("databaseUrl")
  .command("serve", "Serve on --port")
  .flags({ port: Env.args.port(), xDisplay: Env.args.xDisplay(false) })
  .needs("oligarchyToken", "automationServerUrl")
  .done()
  .command("guest", "Guests on this machine")
  .command("hold", "Hold guests")
  .flags({ maxJobs: Env.args.maxJobs() })
  .command("named", "Hold guests under a name")
  .flags({ name: Env.args.machineName() })
  .done()
  .done()
  .done()
  .done();

const HOLD_NAMED = ["guest", "hold", "named", "--name", "lock-screen", "--max-jobs", "2"];

describe("create", () => {
  it("runs the command the words name, with its own flags and every one above it (happy)", async () => {
    const result = await Env.create(
      program,
      io({ argv: [...HOLD_NAMED, "--data-dir", "/srv/oligarchy"], env: { DATABASE_URL } }),
    );
    const env = jarl.unwrap(result);
    expectTypeOf(env.command).toEqualTypeOf<"serve" | "guest hold named">();
    if (env.command !== "guest hold named") {
      throw new Error(`expected guest hold named, got ${env.command}`);
    }
    expectTypeOf(env.flags).toEqualTypeOf<{
      serverUrl: string | undefined;
      dataDir: string;
      automation: boolean;
      maxJobs: number;
      name: string;
    }>();
    expectTypeOf(env.vars).toEqualTypeOf<{ databaseUrl: Env.Secret }>();
    expect(env.flags).toEqual({
      serverUrl: undefined,
      dataDir: "/srv/oligarchy",
      automation: false,
      maxJobs: 2,
      name: "lock-screen",
    });
    expect(env.vars.databaseUrl.reveal()).toBe(DATABASE_URL);
    expect(JSON.stringify(env)).not.toContain(SENTINEL);
  });

  it("refuses a command whose needed variable is unset (unhappy)", async () => {
    const result = await Env.create(
      program,
      io({
        argv: ["serve", "--port", "8080"],
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
      const result = await Env.create(
        program,
        io({ argv: HOLD_NAMED, env: { DATABASE_URL: value } }),
      );
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
    const withoutName = HOLD_NAMED.filter((arg) => arg !== "--name" && arg !== "lock-screen");
    const result = await Env.create(program, io({ argv: withoutName, env: { DATABASE_URL } }));
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("--name is required");
  });

  it("layers the process environment over --env-file over .env, flags' variables too (happy)", async () => {
    const result = await Env.create(
      program,
      io({
        argv: ["serve", "--port", "8080", "--automation", "--env-file", ".prod-env"],
        env: { AUTOMATION_SERVER_URL: "from-env" },
        files: {
          ".prod-env": `AUTOMATION_SERVER_URL=from-file\nOLIGARCHY_TOKEN=from-file\nSERVER_URL=${PROXY}\n`,
          ".env":
            "AUTOMATION_SERVER_URL=from-dot\nOLIGARCHY_TOKEN=from-dot\nDATABASE_URL=postgres://from-dot@db.example/oligarchy\n",
        },
      }),
    );
    const env = jarl.unwrap(result);
    if (env.command !== "serve") {
      throw new Error(`expected serve, got ${env.command}`);
    }
    expect(env.flags.automation).toBe(true);
    expect(env.vars.automationServerUrl).toBe("from-env");
    expect(env.vars.oligarchyToken.reveal()).toBe("from-file");
    expect(env.vars.databaseUrl.reveal()).toBe("postgres://from-dot@db.example/oligarchy");
    expect(env.flags.serverUrl).toBe(PROXY);
  });

  it("hands the program oligarchy.json as the file says it (happy)", async () => {
    const file = {
      ...JSON.parse(CONFIG),
      models: { drive: "test/drive", diagnose: "test/diagnose", setup: "test/setup" },
      stepLimit: 7,
      timeouts: { header: "2 seconds", chunk: "5 seconds" },
    };
    const result = await Env.create(
      program,
      io({
        argv: HOLD_NAMED,
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

  it("has no flag of ctrl's or a session's command line: ctrl is a service apps use (unhappy)", () => {
    expectTypeOf(Env.args).not.toHaveProperty("sessionId");
    expectTypeOf(Env.args).not.toHaveProperty("verdict");
    const gone = [
      "agentId",
      "sessionId",
      "testResultId",
      "output",
      "imageId",
      "list",
      "details",
      "history",
      "definitionName",
      "testDescription",
      "instruction",
      "proof",
      "iso",
      "setupOnly",
      "model",
      "id",
      "resultStatus",
      "reason",
      "count",
      "active",
      "json",
      "search",
      "sessionStatus",
      "logs",
      "testDef",
      "testResults",
      "testRun",
      "actions",
      "images",
      "debugLogs",
      "diagnosis",
      "all",
      "key",
      "errorTypeDescription",
      "verdict",
      "type",
      "summary",
    ];
    expect(Object.keys(Env.args).filter((key) => gone.includes(key))).toEqual([]);
  });
});
