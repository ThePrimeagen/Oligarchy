import * as jarl from "jarl";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import * as FakePostgres from "../src/main.ts";

const running: Array<FakePostgres.FakePostgres> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((fake) => fake.stop()));
});

const started = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
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

  it("each start is a fresh database on a free port of its own, sharing nothing with another (happy)", async () => {
    const first = await started();
    const second = await started();
    const client = await connected(first.url);
    await client.query("insert into logs (text) values ('only in the first')");
    await client.end();

    const other = await connected(second.url);
    const read = await other.query("select text from logs");
    await other.end();

    expect(new URL(first.url).port).not.toBe(new URL(second.url).port);
    expect(Number(new URL(second.url).port)).toBeGreaterThan(0);
    expect(read.rows).toEqual([]);
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
    const fake = jarl.unwrap(await FakePostgres.start());
    await fake.stop();

    await expect(connected(fake.url)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("stopping drops a connection already open, and stopping again does nothing (unhappy)", async () => {
    const fake = await started();
    const client = await connected(fake.url);
    const dropped = new Promise<Error>((resolve) => client.once("error", resolve));

    await fake.stop();

    expect((await dropped).message).toMatch(/terminated/i);
    await expect(fake.stop()).resolves.toBeUndefined();
  });
});
