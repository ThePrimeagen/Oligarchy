import * as Db from "@oligarchy/db";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { forget } from "../src/sweep.ts";
import { database, logging } from "./support.ts";

const ATTRIBUTION = { location: "qemu-reverse-proxy" };
const THREE_MINUTES = 180_000;

describe("forgetting silent servers", () => {
  it("one sweep forgets each server of its kind silent longer than silentFor with one line, and keeps a newer one and another kind's (happy)", async () => {
    const { db, servers } = await database();
    jarl.unwrap(
      await db.run((d) =>
        d.execute(sql`
          insert into servers (url, type, heartbeat_at, created_at) values
            ('http://silent', 'qemu', now() - interval '4 minutes', now() - interval '1 hour'),
            ('http://recent', 'qemu', now() - interval '2 minutes', now() - interval '1 hour'),
            ('http://client', 'automation-client', now() - interval '4 minutes', now() - interval '1 hour')`),
      ),
    );
    const { lines, logger } = logging();

    await forget(
      "qemu",
      { servers, logger, attribution: ATTRIBUTION },
      { silentFor: THREE_MINUTES },
    );

    expect(lines).toEqual([
      "[INFO] [global] qemu-reverse-proxy: server forgotten; http://silent silent for 180 seconds",
    ]);
    const left = jarl.unwrap(await servers.listMachines()).map((machine) => machine.url);
    expect(left.sort()).toEqual(["http://client", "http://recent"]);
  });

  it("a sweep that fails is one line with the driver's reason, and it still settles (error)", async () => {
    const refused = new Db.DatabaseError("Failed query: delete from servers ...");
    refused.cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const { lines, logger } = logging();

    await forget(
      "qemu",
      {
        servers: { removeStaleServers: async () => jarl.err(refused) },
        logger,
        attribution: ATTRIBUTION,
      },
      { silentFor: THREE_MINUTES },
    );

    expect(lines).toEqual([
      "[ERROR] [global] qemu-reverse-proxy: stale server cleanup failed: connect ECONNREFUSED 127.0.0.1:5432",
    ]);
  });
});
