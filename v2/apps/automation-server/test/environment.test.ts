import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { environment } from "../src/environment.ts";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");
const DATABASE_URL = "postgres://oligarchy:secret@127.0.0.1:5432/oligarchy";

const created = (options: {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
}) => Env.create(environment, Env.fakeIo({ ...options, files: { [Env.CONFIG_PATH]: CONFIG } }));

describe("the automation server's environment", () => {
  it("DATABASE_URL gives the database, and oligarchy.json the models and the dispatch interval (happy)", async () => {
    const env = jarl.unwrap(await created({ env: { DATABASE_URL } }));

    expect(env.vars.databaseUrl.reveal()).toBe(DATABASE_URL);
    expect(env.config.models).toEqual(JSON.parse(CONFIG).models);
    expect(env.config.automationServer.dispatchInterval).toBe(30_000);
  });

  it("no DATABASE_URL is refused, naming it (unhappy)", async () => {
    const result = await created({});

    expect(jarl.error.is(result, Env.MissingVariable)).toBe(true);
    expect(jarl.is_err(result) && result.error.message).toBe("DATABASE_URL is not set");
  });

  it("a flag it does not take is refused, naming it (unhappy)", async () => {
    const result = await created({ argv: ["--port", "54321"], env: { DATABASE_URL } });

    expect(jarl.error.is(result, Env.UsageError)).toBe(true);
    expect(jarl.is_err(result) && result.error.message).toBe("unknown flag --port");
  });
});
