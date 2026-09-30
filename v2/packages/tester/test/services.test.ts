import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServices, environment, type Services } from "../src/services.ts";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

// The tester's services against a database of its own, the way main builds them.
const created = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      environment,
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const lines: Array<string> = [];
  const services: Services = createServices(env, {
    write: (line) => lines.push(line),
    colors: false,
  });
  cleanups.push(() => services.db.close());
  return { fake, lines, services };
};

const stored = async (services: Services) =>
  jarl.unwrap(await services.logs.listRecent(10)).map((row) => [row.level, row.location, row.text]);

describe("the tester's services", () => {
  it("a line is printed and lands in the logs table (happy)", async () => {
    const { lines, services } = await created();

    services.logger.warning("failing tests: 2", { location: "tester" });
    await services.logger.flush();

    expect(lines).toEqual(["[WARN] [global] tester: failing tests: 2"]);
    expect(await stored(services)).toEqual([["warning", "tester", "failing tests: 2"]]);
  });

  it("when the database shuts down, the dropped connection and the refused insert are both said, and lines still print (unhappy)", async () => {
    const { fake, lines, services } = await created();
    services.logger.info("before", { location: "tester" });
    await services.logger.flush();

    await fake.stop();
    await vi.waitFor(() => {
      expect(lines.some((line) => line.startsWith("[ERROR] [global] db: pool error: "))).toBe(true);
    });
    services.logger.info("after", { location: "tester" });
    await services.logger.flush();

    const afterAt = lines.indexOf("[INFO] [global] tester: after");
    expect(afterAt).toBeGreaterThan(0);
    expect(lines[afterAt + 1]).toMatch(
      /^\[ERROR\] \[global\] db: log insert failed: [\s\S]*ECONNREFUSED/,
    );
  });
});
