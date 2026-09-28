import * as jarl from "jarl";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import * as FakePostgres from "../src/main.ts";

const running: Array<FakePostgres.FakePostgres> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((fake) => fake.stop()));
});

const started = async () => {
  const fake = jarl.unwrap(await FakePostgres.start({ port: 0 }));
  running.push(fake);
  return fake;
};

const connected = async (url: string) => {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
};

describe("the fake postgres", () => {
  it("serves a migrated database: a client at its url stores a log row and reads it back (happy)", async () => {
    const fake = await started();
    const client = await connected(fake.url);

    await client.query("insert into logs (text, level, agent_id) values ($1, $2, $3)", [
      "booted",
      "warning",
      "OLI-1",
    ]);
    const read = await client.query("select text, level, agent_id, location from logs");
    await client.end();

    expect(read.rows).toEqual([
      { text: "booted", level: "warning", agent_id: "OLI-1", location: null },
    ]);
  });

  it("port 0 listens on a free port, and the url names it (happy)", async () => {
    const fake = await started();

    const port = Number(new URL(fake.url).port);
    expect(port).toBeGreaterThan(0);
  });

  it("a port already held is refused, naming the port, and the holder keeps serving (unhappy)", async () => {
    const holder = await started();
    const port = Number(new URL(holder.url).port);

    const second = await FakePostgres.start({ port });

    expect(jarl.error.is(second, FakePostgres.FakePostgresError)).toBe(true);
    expect(jarl.is_err(second) && second.error.message).toContain(`127.0.0.1:${String(port)}`);
    const client = await connected(holder.url);
    const read = await client.query("select 1 as one");
    await client.end();
    expect(read.rows).toEqual([{ one: 1 }]);
  });

  it("once stopped, the url refuses connections (unhappy)", async () => {
    const fake = jarl.unwrap(await FakePostgres.start({ port: 0 }));
    await fake.stop();

    await expect(connected(fake.url)).rejects.toThrow(/ECONNREFUSED/);
  });
});
