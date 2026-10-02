import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeServices, createServices, type Services } from "../src/services.ts";

import { environment } from "../src/environment.ts";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");
const ENVELOPES = "https://o4510324148862976.ingest.us.sentry.io/api/4512001067581440/envelope/";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

// The tester's services against a database of its own, the way main builds them, with Sentry's
// requests answered by sentry.
const created = async (sentry: Fake.Options["replies"] = Fake.status(200)) => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      environment,
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const lines: Array<string> = [];
  const http = Fake.http({ replies: sentry });
  const services: Services = createServices(env, {
    terminal: { write: (line) => lines.push(line), colors: false },
    http: http.http,
  });
  cleanups.push(() => services.db.close());
  return { fake, lines, services, asked: http.asked };
};

const stored = async (services: Services) =>
  jarl.unwrap(await services.logs.listRecent(10)).map((row) => [row.level, row.location, row.text]);

// What Sentry was sent: where each request went, and its body as text.
const envelopes = (asked: ReadonlyArray<Fake.Asked>) =>
  asked.map(({ method, url, body }) => ({
    method,
    at: url.split("?", 1)[0],
    body: body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body),
  }));

describe("the tester's services", () => {
  it("a line is printed and lands in the logs table (happy)", async () => {
    const { lines, services } = await created();

    services.logger.warning("failing tests: 2", { location: "tester" });
    await services.logger.flush();

    expect(lines).toEqual(["[WARN] [global] tester: failing tests: 2"]);
    expect(await stored(services)).toEqual([["warning", "tester", "failing tests: 2"]]);
  });

  it("an error line reaches the project's Sentry before closing settles, and the database closes (happy)", async () => {
    const { lines, services, asked } = await created();

    services.logger.error("could not count tests: timeout", { location: "tester" });
    const closed = await closeServices(services);

    expect(jarl.is_ok(closed)).toBe(true);
    expect(lines).toEqual(["[ERROR] [global] tester: could not count tests: timeout"]);
    const sent = envelopes(asked);
    expect(sent.map(({ method, at }) => ({ method, at }))).toEqual([
      { method: "POST", at: ENVELOPES },
    ]);
    expect(sent[0]?.body).toContain("could not count tests: timeout");
    expect(jarl.is_err(await services.logs.listRecent(1))).toBe(true);
  });

  it("with Sentry unreachable, an error line is still printed and stored, and closing still settles (unhappy)", async () => {
    const { lines, services, asked } = await created("unreachable");

    services.logger.error("could not count tests: timeout", { location: "tester" });
    await services.logger.flush();

    expect(lines).toEqual(["[ERROR] [global] tester: could not count tests: timeout"]);
    expect(await stored(services)).toEqual([["error", "tester", "could not count tests: timeout"]]);
    expect(jarl.is_ok(await closeServices(services))).toBe(true);
    expect(envelopes(asked).map(({ at }) => at)).toEqual([ENVELOPES]);
  });

  it("closing twice: the second close is the database's error (unhappy)", async () => {
    const { services } = await created();

    expect(jarl.is_ok(await closeServices(services))).toBe(true);
    const again = await closeServices(services);

    expect(jarl.is_err(again) && again.error.message).toMatch(/end on pool more than once/);
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
