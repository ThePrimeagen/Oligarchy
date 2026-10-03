import * as Db from "@oligarchy/db";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { database, MISSING, newJob } from "./support.ts";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("which server holds a job's guest", () => {
  it("a routed job reads back the server it was placed on (happy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.addServer("http://qemu-1", "qemu"));

    jarl.unwrap(await servers.routeJob(job.id, "http://qemu-1"));

    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://qemu-1");
  });

  it("a job never routed names no server (unhappy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.addServer("http://qemu-1", "qemu"));

    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBeUndefined();
    expect(jarl.unwrap(await servers.serverForJob(MISSING))).toBeUndefined();
  });

  it("one server per job: a second route is a database error and the first stands (unhappy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.addServer("http://qemu-1", "qemu"));
    jarl.unwrap(await servers.routeJob(job.id, "http://qemu-1"));

    jarl.unwrap(await servers.addServer("http://qemu-2", "qemu"));
    const again = await servers.routeJob(job.id, "http://qemu-2");

    expect(jarl.error.is(again, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://qemu-1");
  });

  it("removing a runner clears its job assignments (unhappy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.addServer("http://qemu-1", "qemu"));
    jarl.unwrap(await servers.routeJob(job.id, "http://qemu-1"));

    expect(jarl.unwrap(await servers.removeServer("http://qemu-1"))).toBe(true);

    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBeUndefined();
  });

  it("expiry clears only the silent runner's assignments and permits its pending job to be placed again", async () => {
    const { db, tests, servers } = await database();
    const pending = await newJob(tests);
    const running = await newJob(tests);
    const healthy = await newJob(tests);
    for (const url of ["http://silent", "http://healthy"]) {
      jarl.unwrap(await servers.addServer(url, "qemu"));
    }
    jarl.unwrap(await servers.addServer("http://client", "automation-client"));
    jarl.unwrap(await servers.routeJob(pending.id, "http://silent"));
    jarl.unwrap(await servers.routeJob(running.id, "http://silent"));
    jarl.unwrap(await tests.runJob(running.id, MISSING));
    jarl.unwrap(await servers.routeJob(healthy.id, "http://healthy"));
    jarl.unwrap(
      await db.run((d) =>
        d.execute(sql`
      update servers set heartbeat_at = now() - interval '46 seconds'
      where url in ('http://silent', 'http://client')
    `),
      ),
    );

    expect(jarl.unwrap(await servers.removeStaleServers("qemu", 45_000))).toEqual([
      "http://silent",
    ]);
    expect(jarl.unwrap(await servers.serverForJob(pending.id))).toBeUndefined();
    expect(jarl.unwrap(await servers.serverForJob(running.id))).toBeUndefined();
    expect(jarl.unwrap(await servers.serverForJob(healthy.id))).toBe("http://healthy");
    expect(jarl.unwrap(await servers.listServers("automation-client"))).toEqual(["http://client"]);
    expect(jarl.unwrap(await tests.getJob(pending.id)).status).toBe("pending");
    expect(jarl.unwrap(await tests.getJob(running.id)).status).toBe("running");
    expect(
      jarl.error.is(await servers.routeJob(pending.id, "http://silent"), Db.DatabaseError),
    ).toBe(true);
    jarl.unwrap(await servers.routeJob(pending.id, "http://healthy"));
    expect(jarl.unwrap(await servers.serverForJob(pending.id))).toBe("http://healthy");
  });

  it("keeps a runner and its assignment while its heartbeat is within the expiry window", async () => {
    const { db, tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.addServer("http://healthy", "qemu"));
    jarl.unwrap(await servers.routeJob(job.id, "http://healthy"));
    jarl.unwrap(
      await db.run((d) =>
        d.execute(sql`
      update servers set heartbeat_at = now() - interval '30 seconds' where url = 'http://healthy'
    `),
      ),
    );
    expect(jarl.unwrap(await servers.removeStaleServers("qemu", 45_000))).toEqual([]);
    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://healthy");
  });

  it.each(["expiry", "explicit removal"])(
    "rolls back %s if deleting assignments fails",
    async (kind) => {
      const { db, tests, servers } = await database();
      const job = await newJob(tests);
      jarl.unwrap(await servers.addServer("http://silent", "qemu"));
      jarl.unwrap(await servers.routeJob(job.id, "http://silent"));
      jarl.unwrap(
        await db.run(async (d) => {
          await d.execute(sql`update servers set heartbeat_at = now() - interval '46 seconds'`);
          await d.execute(
            sql`create function refuse_route_delete() returns trigger language plpgsql as $$ begin raise exception 'route cleanup refused'; end $$`,
          );
          await d.execute(
            sql`create trigger refuse_route_delete before delete on job_servers for each row execute function refuse_route_delete()`,
          );
        }),
      );
      const result =
        kind === "expiry"
          ? await servers.removeStaleServers("qemu", 45_000)
          : await servers.removeServer("http://silent");
      expect(jarl.error.is(result, Db.DatabaseError)).toBe(true);
      expect(jarl.unwrap(await servers.listServers("qemu"))).toEqual(["http://silent"]);
      expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://silent");
    },
  );
});
