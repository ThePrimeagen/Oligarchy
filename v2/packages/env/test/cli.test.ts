import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";
import * as Cli from "../src/cli.ts";
import * as Errors from "../src/errors.ts";

const spec = {
  action: Cli.string({ description: "drive or mint", schema: z.enum(["drive", "mint"]) }),
  agentId: Cli.string({ description: "The ticket the run is filed on" }),
  serverUrl: Cli.string({
    description: "Where the qemu server listens",
    env: "SERVER_URL",
    default: "http://127.0.0.1:42069",
  }),
  steps: Cli.string({
    description: "Most tool calls the run may make",
    env: "STEPS",
    schema: z.coerce.number().int().min(1),
    default: 10,
  }),
  sessionId: Cli.optional(Cli.string({ description: "Session to reuse", env: "SESSION_ID" })),
  debugLog: Cli.optional(Cli.string({ description: "File for one JSON line per step" })),
  verbose: Cli.boolean({ description: "Print every step" }),
};

const tokens = async (argv: ReadonlyArray<string>) =>
  Object.fromEntries(await jarl.unwrap(Cli.tokenize(argv, spec)));

const parse = async (argv: ReadonlyArray<string>, vars: Readonly<Record<string, string>> = {}) =>
  Cli.resolve(spec, await jarl.unwrap(Cli.tokenize(argv, spec)), vars);

const usage = async (
  pending: Promise<
    jarl.Result<unknown, Errors.UsageError | Errors.HelpRequested | Errors.Unexpected>
  >,
): Promise<string> => {
  const result = await pending;
  if (!jarl.error.is(result, Errors.UsageError)) {
    throw new Error("expected UsageError");
  }
  return result.error.message;
};

const REQUIRED = ["--action", "drive", "--agent-id", "OLI-1"];

describe("tokenize", () => {
  it("reads --flag value, --flag=value and a bare boolean (happy)", async () => {
    expect(await tokens(["--action", "drive", "--agent-id=OLI-1", "--verbose"])).toEqual({
      action: "drive",
      "agent-id": "OLI-1",
      verbose: "true",
    });
  });

  it("keeps the last value of a repeated flag (happy)", async () => {
    expect(await tokens(["--agent-id", "OLI-1", "--agent-id", "OLI-2"])).toEqual({
      "agent-id": "OLI-2",
    });
  });

  it("refuses a flag the command does not declare (unhappy)", async () => {
    expect(await usage(Cli.tokenize(["--nope"], spec))).toBe("unknown flag --nope");
  });

  it("refuses the camelCase spelling: flags are kebab-case (unhappy)", async () => {
    expect(await usage(Cli.tokenize(["--agentId", "OLI-1"], spec))).toBe("unknown flag --agentId");
  });

  it("refuses a value flag with nothing after it (unhappy)", async () => {
    expect(await usage(Cli.tokenize(["--agent-id"], spec))).toBe("--agent-id needs a value");
    expect(await usage(Cli.tokenize(["--agent-id", "--verbose"], spec))).toBe(
      "--agent-id needs a value",
    );
    expect(await usage(Cli.tokenize(["--agent-id="], spec))).toBe("--agent-id needs a value");
  });

  it("refuses an argument that is not a flag (unhappy)", async () => {
    expect(await usage(Cli.tokenize(["drive"], spec))).toBe("unexpected argument drive");
    expect(await usage(Cli.tokenize(["--", "--agent-id", "x"], spec))).toBe(
      "unexpected argument --",
    );
  });
});

describe("resolve", () => {
  it("returns every flag typed as its declaration says (happy)", async () => {
    const result = await parse([
      ...REQUIRED,
      "--steps",
      "5",
      "--debug-log",
      "/tmp/log",
      "--verbose",
    ]);
    expectTypeOf(result).toEqualTypeOf<
      jarl.Result<
        {
          action: "drive" | "mint";
          agentId: string;
          serverUrl: string;
          steps: number;
          sessionId: string | undefined;
          debugLog: string | undefined;
          verbose: boolean;
        },
        Errors.UsageError | Errors.Unexpected
      >
    >();
    expect(jarl.unwrap(result)).toEqual({
      action: "drive",
      agentId: "OLI-1",
      serverUrl: "http://127.0.0.1:42069",
      steps: 5,
      sessionId: undefined,
      debugLog: "/tmp/log",
      verbose: true,
    });
  });

  it("fills an absent flag from its default, and an optional one with undefined (happy)", async () => {
    expect(await jarl.unwrap(parse(REQUIRED))).toMatchObject({
      serverUrl: "http://127.0.0.1:42069",
      steps: 10,
      sessionId: undefined,
      debugLog: undefined,
      verbose: false,
    });
  });

  it("falls back to the flag's variable when the flag is absent (happy)", async () => {
    const flags = await jarl.unwrap(parse(REQUIRED, { SERVER_URL: "http://prod:1", STEPS: "7" }));
    expect(flags).toMatchObject({ serverUrl: "http://prod:1", steps: 7 });
  });

  it("lets the flag win over its variable (happy)", async () => {
    const flags = await jarl.unwrap(
      parse([...REQUIRED, "--server-url", "http://flag:1"], { SERVER_URL: "http://env:1" }),
    );
    expect(flags.serverUrl).toBe("http://flag:1");
  });

  it("reads --verbose=false as false (happy)", async () => {
    expect((await jarl.unwrap(parse([...REQUIRED, "--verbose=false"]))).verbose).toBe(false);
  });

  it("names a missing required flag (unhappy)", async () => {
    expect(await usage(parse(["--action", "drive"]))).toBe("--agent-id is required");
  });

  it("names the variable a required flag could also come from (unhappy)", async () => {
    const withSession = {
      sessionId: Cli.string({ description: "Session to reuse", env: "SESSION_ID" }),
    };
    const raw = await jarl.unwrap(Cli.tokenize([], withSession));
    expect(await usage(Cli.resolve(withSession, raw, {}))).toBe(
      "--session-id is required (or set SESSION_ID)",
    );
  });

  it("names the flag whose value the schema refuses (unhappy)", async () => {
    expect(await usage(parse(["--action", "fly", "--agent-id", "OLI-1"]))).toMatch(/^--action: /);
    expect(await usage(parse([...REQUIRED, "--steps", "0"]))).toMatch(/^--steps: /);
    expect(await usage(parse([...REQUIRED, "--verbose=maybe"]))).toBe(
      "--verbose: must be true or false",
    );
  });

  it("names the variable, not the flag, when the fallback value is refused (unhappy)", async () => {
    expect(await usage(parse(REQUIRED, { STEPS: "many" }))).toMatch(/^STEPS \(for --steps\): /);
  });

  it("resolves a schema that throws as Unexpected instead of rejecting (unhappy)", async () => {
    const throwing = {
      port: Cli.string({
        description: "Port",
        schema: z.string().transform((): number => {
          throw new TypeError("transform blew up");
        }),
      }),
    };
    const raw = await jarl.unwrap(Cli.tokenize(["--port", "80"], throwing));
    const result = await Cli.resolve(throwing, raw, {});
    if (!jarl.error.is(result, Errors.Unexpected)) {
      throw new Error("expected Unexpected");
    }
    expect(result.error.message).toBe("unexpected: transform blew up");
  });
});

describe("help", () => {
  it("lists every flag with its description and fallback variable (happy)", () => {
    const text = Cli.help("driver", "Run the harness loop", spec);
    for (const expected of [
      "driver",
      "--agent-id",
      "The ticket the run is filed on",
      "SERVER_URL",
    ]) {
      expect(text).toContain(expected);
    }
  });
});
