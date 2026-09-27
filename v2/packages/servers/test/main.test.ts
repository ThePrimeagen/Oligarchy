import { randomUUID } from "node:crypto";
import * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Servers from "../src/main.ts";
import { database, value } from "./support.ts";

const stats = (qemus: number): Servers.ServerStats => ({
  qemus,
  memory: { totalBytes: 16_000, usedBytes: 4_000 },
  cpu: { mean1m: 22.3, mean2m: 21.4, mean3m: 20.9 },
});

const opened = async () => {
  const { db, exec } = await database();
  const servers = Servers.create(db);
  const machine = async (url: string) =>
    value(await servers.listMachines()).find((row) => row.url === url);
  // Heartbeats and registrations are stamped by the database's clock; a test moves them back.
  const heartbeatAgo = (url: string, ago: string) =>
    exec(`update servers set heartbeat_at = now() - $2::interval where url = $1`, [url, ago]);
  const registeredAgo = (url: string, ago: string) =>
    exec(`update servers set created_at = now() - $2::interval where url = $1`, [url, ago]);
  const session = async () => {
    const id = randomUUID();
    await exec(`insert into sessions (id, config) values ($1, '{"iso":"x"}')`, [id]);
    return id;
  };
  return { servers, machine, heartbeatAgo, registeredAgo, session };
};

describe("addServer", () => {
  it("registers a url no process has claimed: no name, no stats, no heartbeat, generation 0 (happy)", async () => {
    const { servers, machine } = await opened();

    expect(await servers.addServer("http://10.0.0.5:1", "qemu")).toEqual(jarl.ok(undefined));

    expect(await machine("http://10.0.0.5:1")).toMatchObject({
      url: "http://10.0.0.5:1",
      name: null,
      type: "qemu",
      stats: null,
      generation: 0,
      heartbeatAt: null,
    });
  });

  it("registers a url twice as one row (unhappy)", async () => {
    const { servers } = await opened();

    value(await servers.addServer("http://10.0.0.5:1", "automation-client"));
    expect(await servers.addServer("http://10.0.0.5:1", "automation-client")).toEqual(
      jarl.ok(undefined),
    );

    expect(value(await servers.listServers("automation-client"))).toEqual(["http://10.0.0.5:1"]);
  });
});

describe("heartbeat", () => {
  it("writes generation 1 on the first beat, then counts up with the stats rewritten (happy)", async () => {
    const { servers, machine } = await opened();
    const url = "http://10.0.0.7:1";

    value(await servers.heartbeat(url, "qemu", "garage", stats(1)));
    const first = await machine(url);
    expect(first).toMatchObject({ name: "garage", type: "qemu", stats: stats(1), generation: 1 });
    expect(first?.heartbeatAt).toBeInstanceOf(Date);

    value(await servers.heartbeat(url, "qemu", "garage", stats(2)));
    const second = await machine(url);
    expect(second).toMatchObject({ stats: stats(2), generation: 2 });
    expect(second?.heartbeatAt?.getTime()).toBeGreaterThanOrEqual(
      first?.heartbeatAt?.getTime() ?? 0,
    );
    expect(value(await servers.listMachines())).toHaveLength(1);
  });

  it("claims the row an operator added: still one row, now named, generation 1 (unhappy)", async () => {
    const { servers, machine } = await opened();
    const url = "http://10.0.0.8:1";
    value(await servers.addServer(url, "qemu"));

    value(await servers.heartbeat(url, "automation-client", "claimed", stats(0)));

    expect(await machine(url)).toMatchObject({
      name: "claimed",
      type: "automation-client",
      stats: stats(0),
      generation: 1,
    });
    expect(value(await servers.listMachines())).toHaveLength(1);
  });

  it("keeps a name to one url: a second url under it is refused and the first keeps it (unhappy)", async () => {
    const { servers, machine } = await opened();
    value(await servers.heartbeat("http://10.0.0.40:1", "qemu", "taken", stats(0)));

    const second = await servers.heartbeat("http://10.0.0.41:1", "qemu", "taken", stats(0));

    expect(jarl.error.is(second, Db.DatabaseError)).toBe(true);
    expect(await machine("http://10.0.0.40:1")).toMatchObject({ name: "taken" });
    expect(await machine("http://10.0.0.41:1")).toBeUndefined();
  });
});

describe("removeServer", () => {
  it("is true when it forgot a registered url (happy)", async () => {
    const { servers } = await opened();
    value(await servers.addServer("http://10.0.0.5:1", "qemu"));
    value(await servers.addServer("http://10.0.0.6:1", "qemu"));

    expect(await servers.removeServer("http://10.0.0.5:1")).toEqual(jarl.ok(true));

    expect(value(await servers.listServers("qemu"))).toEqual(["http://10.0.0.6:1"]);
  });

  it("is false when nothing is registered under the url, a second remove included (unhappy)", async () => {
    const { servers } = await opened();
    value(await servers.addServer("http://10.0.0.5:1", "qemu"));
    value(await servers.removeServer("http://10.0.0.5:1"));

    expect(await servers.removeServer("http://10.0.0.5:1")).toEqual(jarl.ok(false));
    expect(await servers.removeServer("http://10.0.0.9:1")).toEqual(jarl.ok(false));
  });
});

describe("listServers", () => {
  it("lists one kind in registration order, whatever the urls sort as (happy)", async () => {
    const { servers, registeredAgo } = await opened();
    value(await servers.addServer("http://b:1", "qemu"));
    value(await servers.addServer("http://a:1", "qemu"));
    await registeredAgo("http://b:1", "2 seconds");
    await registeredAgo("http://a:1", "1 second");

    expect(await servers.listServers("qemu")).toEqual(jarl.ok(["http://b:1", "http://a:1"]));
  });

  it("never lists the other kind, and is empty with none of its own (unhappy)", async () => {
    const { servers } = await opened();
    value(await servers.heartbeat("http://client:1", "automation-client", "client", stats(0)));

    expect(await servers.listServers("qemu")).toEqual(jarl.ok([]));
    expect(await servers.listServers("automation-client")).toEqual(jarl.ok(["http://client:1"]));
  });
});

describe("listMachines", () => {
  it("lists the qemu servers before the automation clients, each kind in registration order (happy)", async () => {
    const { servers, registeredAgo } = await opened();
    value(await servers.heartbeat("http://client:1", "automation-client", "client", stats(0)));
    value(await servers.addServer("http://qemu-b:1", "qemu"));
    value(await servers.heartbeat("http://qemu-a:1", "qemu", "qemu-a", stats(1)));
    await registeredAgo("http://client:1", "3 seconds");
    await registeredAgo("http://qemu-b:1", "2 seconds");
    await registeredAgo("http://qemu-a:1", "1 second");

    const machines = value(await servers.listMachines());

    expect(machines.map((row) => row.url)).toEqual([
      "http://qemu-b:1",
      "http://qemu-a:1",
      "http://client:1",
    ]);
  });

  it("carries the database's clock, so a heartbeat's age is read against the clock that stamped it (happy)", async () => {
    const { servers, machine, heartbeatAgo } = await opened();
    value(await servers.heartbeat("http://qemu:1", "qemu", "qemu", stats(1)));
    await heartbeatAgo("http://qemu:1", "30 seconds");

    const row = await machine("http://qemu:1");

    const age = (row?.queriedAt.getTime() ?? 0) - (row?.heartbeatAt?.getTime() ?? 0);
    expect(age).toBeGreaterThanOrEqual(30_000);
    expect(age).toBeLessThan(40_000);
  });
});

describe("listLiveServers", () => {
  it("keeps a server whose last heartbeat is 40 seconds old (happy)", async () => {
    const { servers, heartbeatAgo } = await opened();
    value(await servers.heartbeat("http://fresh:1", "automation-client", "fresh", stats(0)));
    await heartbeatAgo("http://fresh:1", "40 seconds");

    const live = value(await servers.listLiveServers("automation-client"));

    expect(live.map((server) => server.url)).toEqual(["http://fresh:1"]);
  });

  it("drops a 46 second old heartbeat, the other kind, and a row that never beat (unhappy)", async () => {
    const { servers, heartbeatAgo } = await opened();
    value(await servers.heartbeat("http://stale:1", "automation-client", "stale", stats(0)));
    value(await servers.heartbeat("http://qemu:1", "qemu", "qemu", stats(0)));
    value(await servers.addServer("http://silent:1", "automation-client"));
    await heartbeatAgo("http://stale:1", "46 seconds");

    expect(await servers.listLiveServers("automation-client")).toEqual(jarl.ok([]));
  });
});

describe("removeStaleServers", () => {
  it("forgets a kind's rows ten minutes silent, a row nobody claimed counting from its registration, and names them (happy)", async () => {
    const { servers, heartbeatAgo, registeredAgo } = await opened();
    value(await servers.heartbeat("http://dead:1", "qemu", "dead", stats(0)));
    value(await servers.addServer("http://unclaimed:1", "qemu"));
    await heartbeatAgo("http://dead:1", "10 minutes 1 second");
    await registeredAgo("http://unclaimed:1", "10 minutes 1 second");

    const forgotten = value(await servers.removeStaleServers("qemu"));

    expect(forgotten).toHaveLength(2);
    expect(forgotten).toEqual(expect.arrayContaining(["http://dead:1", "http://unclaimed:1"]));
    expect(await servers.listServers("qemu")).toEqual(jarl.ok([]));
  });

  it("keeps a heartbeat under ten minutes old, a row just added, and the other kind however silent (unhappy)", async () => {
    const { servers, heartbeatAgo } = await opened();
    value(await servers.heartbeat("http://alive:1", "qemu", "alive", stats(0)));
    value(await servers.addServer("http://just-added:1", "qemu"));
    value(await servers.heartbeat("http://client:1", "automation-client", "client", stats(0)));
    await heartbeatAgo("http://alive:1", "9 minutes 30 seconds");
    await heartbeatAgo("http://client:1", "1 hour");

    expect(await servers.removeStaleServers("qemu")).toEqual(jarl.ok([]));

    const kept = value(await servers.listServers("qemu"));
    expect(kept).toHaveLength(2);
    expect(kept).toEqual(expect.arrayContaining(["http://alive:1", "http://just-added:1"]));
    expect(await servers.removeStaleServers("automation-client")).toEqual(
      jarl.ok(["http://client:1"]),
    );
  });
});

describe("findServer", () => {
  it("finds a server by the id a job stored when it was claimed (happy)", async () => {
    const { servers } = await opened();
    value(await servers.heartbeat("http://client:1", "automation-client", "client", stats(0)));
    const [live] = value(await servers.listLiveServers("automation-client"));

    expect(await servers.findServer(live?.id ?? "")).toEqual(
      jarl.ok({ id: live?.id, url: "http://client:1" }),
    );
  });

  it("is undefined for an id no server has, a forgotten one included (unhappy)", async () => {
    const { servers } = await opened();
    value(await servers.heartbeat("http://client:1", "automation-client", "client", stats(0)));
    const [live] = value(await servers.listLiveServers("automation-client"));
    value(await servers.removeServer("http://client:1"));

    expect(await servers.findServer(live?.id ?? "")).toEqual(jarl.ok(undefined));
    expect(await servers.findServer(randomUUID())).toEqual(jarl.ok(undefined));
  });
});

describe("routeSession", () => {
  it("routes a session, and answers where it went (happy)", async () => {
    const { servers, session } = await opened();
    const id = await session();

    expect(await servers.routeSession(id, "http://10.0.0.5:1")).toEqual(jarl.ok(undefined));

    expect(await servers.serverForSession(id)).toEqual(jarl.ok("http://10.0.0.5:1"));
  });

  it("keeps a route after its server is forgotten, so its sessions stay reachable (happy)", async () => {
    const { servers, session } = await opened();
    const id = await session();
    value(await servers.addServer("http://10.0.0.5:1", "qemu"));
    value(await servers.routeSession(id, "http://10.0.0.5:1"));

    value(await servers.removeServer("http://10.0.0.5:1"));

    expect(await servers.serverForSession(id)).toEqual(jarl.ok("http://10.0.0.5:1"));
  });

  it("is undefined for a session never routed (unhappy)", async () => {
    const { servers, session } = await opened();

    expect(await servers.serverForSession(await session())).toEqual(jarl.ok(undefined));
  });

  it("refuses a second route, and the first stays (unhappy)", async () => {
    const { servers, session } = await opened();
    const id = await session();
    value(await servers.routeSession(id, "http://10.0.0.5:1"));

    const twice = await servers.routeSession(id, "http://10.0.0.6:1");

    expect(jarl.error.is(twice, Db.DatabaseError)).toBe(true);
    expect(await servers.serverForSession(id)).toEqual(jarl.ok("http://10.0.0.5:1"));
  });

  it("refuses a route for a session that does not exist (unhappy)", async () => {
    const { servers } = await opened();
    const id = randomUUID();

    const routed = await servers.routeSession(id, "http://10.0.0.5:1");

    expect(jarl.error.is(routed, Db.DatabaseError)).toBe(true);
    expect(await servers.serverForSession(id)).toEqual(jarl.ok(undefined));
  });
});

describe("routeAgent", () => {
  it("routes an agent to the first server placed, and clearAgent frees it to be placed again (happy)", async () => {
    const { servers } = await opened();
    value(await servers.routeAgent("OLI-61", "http://10.0.0.5:1"));
    expect(await servers.serverForAgent("OLI-61")).toEqual(jarl.ok("http://10.0.0.5:1"));

    value(await servers.clearAgent("OLI-61"));
    value(await servers.routeAgent("OLI-61", "http://10.0.0.6:1"));

    expect(await servers.serverForAgent("OLI-61")).toEqual(jarl.ok("http://10.0.0.6:1"));
  });

  it("keeps the first server when a racing second route arrives (unhappy)", async () => {
    const { servers } = await opened();
    value(await servers.routeAgent("OLI-61", "http://10.0.0.5:1"));

    expect(await servers.routeAgent("OLI-61", "http://10.0.0.6:1")).toEqual(jarl.ok(undefined));

    expect(await servers.serverForAgent("OLI-61")).toEqual(jarl.ok("http://10.0.0.5:1"));
  });

  it("is undefined for an agent never routed, or cleared (unhappy)", async () => {
    const { servers } = await opened();
    expect(await servers.serverForAgent("OLI-62")).toEqual(jarl.ok(undefined));
    value(await servers.routeAgent("OLI-62", "http://10.0.0.5:1"));

    value(await servers.clearAgent("OLI-62"));

    expect(await servers.serverForAgent("OLI-62")).toEqual(jarl.ok(undefined));
  });
});
