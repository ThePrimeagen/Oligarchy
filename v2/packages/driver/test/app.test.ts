import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as App from "../src/app.ts";

const files = { [Env.CONFIG_PATH]: readFileSync(Env.CONFIG_PATH, "utf8") };
const ARGV = ["--action", "mint", "--prompt", "hi", "--agent-id", "OLI-1"];
const SECRETS = { OPENROUTER_API_KEY: "sk-or", DATABASE_URL: "postgres://db" };

describe("driver env", () => {
  it("holds its flags, the two secrets it names and oligarchy.json, each typed (happy)", async () => {
    const result = await Env.create(App.app, Env.fakeIo({ argv: ARGV, env: SECRETS, files }));
    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    const env = result.value;
    expectTypeOf(env.command).toEqualTypeOf<"">();
    expectTypeOf(env.flags.action).toEqualTypeOf<"drive" | "mint">();
    expectTypeOf(env.flags.debugLog).toEqualTypeOf<string | undefined>();
    expectTypeOf(env.vars).toEqualTypeOf<{
      openRouterToken: Env.Secret;
      databaseUrl: Env.Secret;
    }>();
    expectTypeOf(env.config).toEqualTypeOf<Env.Config>();
    expect(env.flags).toMatchObject({ action: "mint", agentId: "OLI-1" });
    expect(env.vars.openRouterToken.reveal()).toBe("sk-or");
  });

  it("refuses an action other than drive or mint (unhappy)", async () => {
    const argv = ["--action", "fly", "--prompt", "hi", "--agent-id", "OLI-1"];
    const result = await Env.create(App.app, Env.fakeIo({ argv, env: SECRETS, files }));
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toMatch(/^--action: /);
  });

  it("reports OPENROUTER_API_KEY before DATABASE_URL (unhappy)", async () => {
    const result = await Env.create(App.app, Env.fakeIo({ argv: ARGV, files }));
    if (!jarl.error.is(result, Env.MissingVariable)) {
      throw new Error("expected MissingVariable");
    }
    expect(result.error.message).toBe("OPENROUTER_API_KEY is not set");
  });

  it("asks for help, and the help names the driver's flags (happy)", async () => {
    const result = await Env.create(App.app, Env.fakeIo({ argv: ["--help"] }));
    if (!jarl.error.is(result, Env.HelpRequested)) {
      throw new Error("expected HelpRequested");
    }
    expect(result.error.text).toContain("--agent-id");
  });
});
