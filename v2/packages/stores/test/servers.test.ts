import * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, MISSING, newJob } from "./support.ts";

describe("which server holds a job's guest", () => {
  it("a routed job reads back the server it was placed on (happy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);

    jarl.unwrap(await servers.routeJob(job.id, "http://qemu-1"));

    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://qemu-1");
  });

  it("a job never routed names no server (unhappy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);

    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBeUndefined();
    expect(jarl.unwrap(await servers.serverForJob(MISSING))).toBeUndefined();
  });

  it("one server per job: a second route is a database error and the first stands (unhappy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.routeJob(job.id, "http://qemu-1"));

    const again = await servers.routeJob(job.id, "http://qemu-2");

    expect(jarl.error.is(again, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://qemu-1");
  });

  it("forgetting the server keeps its jobs routable (unhappy)", async () => {
    const { tests, servers } = await database();
    const job = await newJob(tests);
    jarl.unwrap(await servers.addServer("http://qemu-1", "qemu"));
    jarl.unwrap(await servers.routeJob(job.id, "http://qemu-1"));

    expect(jarl.unwrap(await servers.removeServer("http://qemu-1"))).toBe(true);

    expect(jarl.unwrap(await servers.serverForJob(job.id))).toBe("http://qemu-1");
  });
});
