import * as Db from "@oligarchy/db";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it, vi } from "vitest";
import { forget } from "../src/sweep.ts";
import { database, held, logging } from "./support.ts";

const ATTRIBUTION = { location: "qemu-reverse-proxy" };

type Swept = jarl.Result<ReadonlyArray<string>, Db.DatabaseError>;

describe("forgetting silent servers", () => {
  it("forgets a server of its kind silent ten minutes with one line, and keeps a fresh one and another kind's (happy)", async () => {
    const { db, servers } = await database();
    jarl.unwrap(
      await db.run((d) =>
        d.execute(sql`
          insert into servers (url, type, heartbeat_at, created_at) values
            ('http://silent', 'qemu', now() - interval '11 minutes', now() - interval '1 hour'),
            ('http://client', 'automation-client', now() - interval '11 minutes', now() - interval '1 hour')`),
      ),
    );
    jarl.unwrap(
      await servers.heartbeat("http://fresh", "qemu", "fresh", {
        qemus: 0,
        memory: { totalBytes: 1, usedBytes: 1 },
        cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
      }),
    );
    const { lines, logger } = logging();
    const stop = new AbortController();

    const swept = forget("qemu", { servers, logger, attribution: ATTRIBUTION }, stop.signal);
    await vi.waitFor(() => {
      expect(lines).toHaveLength(1);
    });
    stop.abort();
    await swept;

    expect(lines).toEqual([
      "[INFO] [global] qemu-reverse-proxy: server forgotten; http://silent silent for 10 minutes",
    ]);
    const left = jarl.unwrap(await servers.listMachines()).map((machine) => machine.url);
    expect(left.sort()).toEqual(["http://client", "http://fresh"]);
  });

  it("a sweep that fails is one line with the driver's reason, and the next tick sweeps (error)", async () => {
    const refused = new Db.DatabaseError("Failed query: delete from servers ...");
    refused.cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const answers: Array<Swept> = [jarl.err(refused), jarl.ok(["http://a"])];
    const { lines, logger } = logging();
    const stop = new AbortController();

    const swept = forget(
      "qemu",
      {
        servers: { removeStaleServers: async () => answers.shift() ?? jarl.ok([]) },
        logger,
        attribution: ATTRIBUTION,
      },
      stop.signal,
      { every: 5 },
    );
    await vi.waitFor(() => {
      expect(lines).toHaveLength(2);
    });
    stop.abort();
    await swept;

    expect(lines).toEqual([
      "[ERROR] [global] qemu-reverse-proxy: stale server cleanup failed: connect ECONNREFUSED 127.0.0.1:5432",
      "[INFO] [global] qemu-reverse-proxy: server forgotten; http://a silent for 10 minutes",
    ]);
  });

  it("an abort during a sweep waits for it, and still says what went (error)", async () => {
    const deleting = held<Swept>();
    let asked = 0;
    const { lines, logger } = logging();
    const stop = new AbortController();

    const swept = forget(
      "qemu",
      {
        servers: {
          removeStaleServers: () => {
            asked += 1;
            return deleting.promise;
          },
        },
        logger,
        attribution: ATTRIBUTION,
      },
      stop.signal,
    );
    await vi.waitFor(() => {
      expect(asked).toBe(1);
    });
    stop.abort();
    deleting.release(jarl.ok(["http://a"]));
    await swept;

    expect(lines).toEqual([
      "[INFO] [global] qemu-reverse-proxy: server forgotten; http://a silent for 10 minutes",
    ]);
  });
});
