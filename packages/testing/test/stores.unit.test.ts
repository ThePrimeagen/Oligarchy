import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import * as Automation from "@oligarchy/db/automation";
import * as DbErrors from "@oligarchy/db/errors";
import * as ProcessStats from "@oligarchy/db/process-stats";
import * as Servers from "@oligarchy/db/servers";
import * as Tests from "@oligarchy/db/tests";
import * as Stores from "../src/stores.ts";

const RESULT = "22222222-2222-4222-8222-222222222222";
const OTHER_RESULT = "33333333-3333-4333-8333-333333333333";
const SERVER = "11111111-1111-4111-8111-111111111111";
const OTHER_SERVER = "44444444-4444-4444-8444-444444444444";

const definition = (id: number, name: string) => ({
  id,
  name,
  description: `${name} description`,
  instruction: `${name} instruction`,
  proof: `${name} proof`,
  createdAt: new Date(),
});

describe("fakeTestStore happy path", () => {
  it.effect("a run holds one pending result per definition, found by the ticket set on it", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeTestStore({
        definitions: [definition(1, "alpha"), definition(2, "beta")],
      });
      yield* Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const definitions = yield* tests.listTestDefinitions;
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://qemu.example",
          definitions,
        });
        expect(created.results.map((row) => row.definitionId)).toEqual([1, 2]);
        expect(fake.results.map((row) => row.status)).toEqual(["pending", "pending"]);
        const first = created.results[0]?.id ?? "";
        yield* tests.setLinearId(first, "OLI-42");
        const found = yield* tests.findResultByLinearId("OLI-42");
        expect(Option.map(found, (row) => row.id)).toEqual(Option.some(first));
      }).pipe(Effect.provide(fake.layer));
    }),
  );

  it.effect("a name's newest wording is its highest id", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeTestStore({
        definitions: [definition(1, "alpha"), definition(3, "alpha"), definition(2, "beta")],
      });
      const latest = yield* Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        return yield* tests.findTestDefinition("alpha");
      }).pipe(Effect.provide(fake.layer));
      expect(Option.map(latest, (row) => row.id)).toEqual(Option.some(3));
    }),
  );
});

describe("fakeTestStore unhappy path", () => {
  it.effect("a ticket another result holds is the unique index's DatabaseError", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeTestStore({ definitions: [definition(1, "alpha")] });
      const error = yield* Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://qemu.example",
          definitions: [definition(1, "alpha"), definition(1, "alpha")],
        });
        yield* tests.setLinearId(created.results[0]?.id ?? "", "OLI-42");
        return yield* Effect.flip(tests.setLinearId(created.results[1]?.id ?? "", "OLI-42"));
      }).pipe(Effect.provide(fake.layer));
      expect(error).toMatchObject({ _tag: "DatabaseError", operation: "setLinearId" });
      expect(String(error.cause)).toContain("duplicate key");
    }),
  );

  it.effect("a ticket set on a result that is not there dies", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeTestStore();
      const exit = yield* Effect.exit(
        Effect.flatMap(Tests.TestStore, (tests) => tests.setLinearId(RESULT, "OLI-42")).pipe(
          Effect.provide(fake.layer),
        ),
      );
      expect(Exit.hasDies(exit)).toBe(true);
    }),
  );

  it.effect("an aborted result is never closed or errored, and an errored one never closed", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeTestStore();
      const row = (id: string, status: "aborted" | "errored") => ({
        id,
        runId: SERVER,
        definitionId: 1,
        sessionId: null,
        model: null,
        linearId: null,
        status,
        reason: null,
        createdAt: new Date(),
        finishedAt: null,
      });
      fake.results.push(row(RESULT, "aborted"), row(OTHER_RESULT, "errored"));
      yield* Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        expect(yield* tests.closeResult(RESULT, "passed", null, null)).toBe(false);
        expect(yield* tests.errorResult(RESULT, "late")).toBe(false);
        expect(yield* tests.closeResult(OTHER_RESULT, "passed", null, null)).toBe(false);
      }).pipe(Effect.provide(fake.layer));
      expect(fake.results.map((result) => result.status)).toEqual(["aborted", "errored"]);
    }),
  );
});

describe("fakeAutomationStore happy path", () => {
  it.effect("the next pending action is a mint, then a diagnose, then a drive, oldest first", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeAutomationStore();
      yield* Effect.gen(function* () {
        const store = yield* Automation.AutomationStore;
        const drive = yield* store.enqueue({ resultId: RESULT, action: "drive" });
        const diagnose = yield* store.enqueue({ resultId: OTHER_RESULT, action: "diagnose" });
        const mint = yield* store.enqueue({ resultId: SERVER, action: "mint" });
        const order: Array<string> = [];
        for (;;) {
          const next = yield* store.nextPending(order);
          if (Option.isNone(next)) {
            break;
          }
          order.push(next.value.id);
        }
        expect(order).toEqual([mint.id, diagnose.id, drive.id]);
      }).pipe(Effect.provide(fake.layer));
    }),
  );

  it.effect("a row already running for the same server is acknowledged", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeAutomationStore();
      yield* Effect.gen(function* () {
        const store = yield* Automation.AutomationStore;
        const job = yield* store.enqueue({ resultId: RESULT, action: "drive" });
        expect(yield* store.markRunning(job.id, SERVER)).toBe(true);
        expect(yield* store.markRunning(job.id, SERVER)).toBe(true);
      }).pipe(Effect.provide(fake.layer));
      expect(fake.jobs.map((job) => [job.status, job.serverId])).toEqual([["running", SERVER]]);
    }),
  );
});

describe("fakeAutomationStore unhappy path", () => {
  it.effect(
    "a second insert for the same result and action is the unique index's DatabaseError",
    () =>
      Effect.gen(function* () {
        const fake = Stores.fakeAutomationStore();
        const error = yield* Effect.gen(function* () {
          const store = yield* Automation.AutomationStore;
          yield* store.enqueue({ resultId: RESULT, action: "drive" });
          return yield* Effect.flip(store.enqueue({ resultId: RESULT, action: "drive" }));
        }).pipe(Effect.provide(fake.layer));
        expect(error._tag).toBe("DatabaseError");
        expect(String(error.cause)).toContain("duplicate key");
        expect(fake.jobs).toHaveLength(1);
      }),
  );

  it.effect("a result with a running action has no next pending action", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeAutomationStore();
      const next = yield* Effect.gen(function* () {
        const store = yield* Automation.AutomationStore;
        const drive = yield* store.enqueue({ resultId: RESULT, action: "drive" });
        yield* store.markRunning(drive.id, SERVER);
        yield* store.enqueue({ resultId: RESULT, action: "diagnose" });
        return yield* store.nextPending();
      }).pipe(Effect.provide(fake.layer));
      expect(Option.isNone(next)).toBe(true);
    }),
  );

  it.effect(
    "a row running for another server, or closed, is not taken, and an unknown id is not",
    () =>
      Effect.gen(function* () {
        const fake = Stores.fakeAutomationStore();
        yield* Effect.gen(function* () {
          const store = yield* Automation.AutomationStore;
          const job = yield* store.enqueue({ resultId: RESULT, action: "drive" });
          yield* store.markRunning(job.id, SERVER);
          expect(yield* store.markRunning(job.id, OTHER_SERVER)).toBe(false);
          expect(yield* store.finish(job.id, "aborted", "aborted")).toBe(true);
          expect(yield* store.markRunning(job.id, SERVER)).toBe(false);
          expect(yield* store.markRunning(OTHER_RESULT, SERVER)).toBe(false);
        }).pipe(Effect.provide(fake.layer));
      }),
  );

  it.effect("a closed row answers true only for the status and reason it closed with", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeAutomationStore();
      yield* Effect.gen(function* () {
        const store = yield* Automation.AutomationStore;
        const job = yield* store.enqueue({ resultId: RESULT, action: "drive" });
        expect(yield* store.finish(job.id, "aborted", "aborted")).toBe(true);
        expect(yield* store.finish(job.id, "aborted", "aborted")).toBe(true);
        expect(yield* store.finish(job.id, "aborted", null)).toBe(true);
        expect(yield* store.finish(job.id, "aborted", "other")).toBe(false);
        expect(yield* store.finish(job.id, "completed", null)).toBe(false);
      }).pipe(Effect.provide(fake.layer));
      expect(fake.jobs.map((job) => [job.status, job.reason])).toEqual([["aborted", "aborted"]]);
    }),
  );
});

const URL = "http://127.0.0.1:55332";
const ROW_STATS = {
  qemus: 1,
  memory: { totalBytes: 16_000, usedBytes: 4_000 },
  cpu: { mean1m: 22.3, mean2m: 21.4, mean3m: 20.9 },
};

describe("fakeServerStore happy path", () => {
  it.effect("a url registers once, and a heartbeat registers the url with its kind and name", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeServerStore();
      yield* Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        yield* store.addServer(URL, "qemu");
        yield* store.addServer(URL, "qemu");
        expect(fake.servers).toEqual([
          { id: expect.any(String), url: URL, name: null, type: "qemu" },
        ]);
        yield* store.heartbeat("http://127.0.0.1:1", "automation-client", "attic", ROW_STATS);
        expect(yield* store.listServers("automation-client")).toEqual(["http://127.0.0.1:1"]);
        expect(yield* store.listLiveServers("qemu")).toEqual([]);
      }).pipe(Effect.provide(fake.layer));
      expect(fake.heartbeats).toEqual([
        { url: "http://127.0.0.1:1", type: "automation-client", name: "attic", stats: ROW_STATS },
      ]);
    }),
  );

  it.effect("removing a server answers whether its row was there", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeServerStore();
      yield* Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        yield* store.heartbeat(URL, "qemu", "garage", ROW_STATS);
        expect(yield* store.removeServer(URL)).toBe(true);
        expect(yield* store.removeServer(URL)).toBe(false);
      }).pipe(Effect.provide(fake.layer));
      expect(fake.servers).toEqual([]);
    }),
  );
});

describe("fakeServerStore unhappy path", () => {
  it.effect("a second route for one session is the primary key's DatabaseError", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeServerStore();
      const error = yield* Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        yield* store.routeSession(SERVER, URL);
        return yield* Effect.flip(store.routeSession(SERVER, "http://127.0.0.1:1"));
      }).pipe(Effect.provide(fake.layer));
      expect(error).toMatchObject({ _tag: "DatabaseError", operation: "routeSession" });
      expect(fake.routes).toEqual(new Map([[SERVER, URL]]));
    }),
  );
});

describe("fakeProcessStatsStore happy path", () => {
  it.effect("keeps every report and answers the newest per process, qemu servers first", () =>
    Effect.gen(function* () {
      const fake = Stores.fakeProcessStatsStore();
      const sample = (jobs: number) => ({ jobs, memoryBytes: 1_024, cpuPercent: 1.5 });
      const series = yield* Effect.gen(function* () {
        const store = yield* ProcessStats.ProcessStatsStore;
        yield* store.report("attic", "automation-client", sample(0));
        yield* store.report("garage", "qemu", sample(1));
        yield* store.report("garage", "qemu", sample(2));
        return yield* store.listSeries(1);
      }).pipe(Effect.provide(fake.layer));
      expect(fake.reports).toHaveLength(3);
      expect(series).toEqual([
        { name: "garage", type: "qemu", samples: [sample(2)] },
        { name: "attic", type: "automation-client", samples: [sample(0)] },
      ]);
    }),
  );
});

describe("fakeProcessStatsStore unhappy path", () => {
  it.effect("an overridden report fails as told and records nothing", () =>
    Effect.gen(function* () {
      const refused = DbErrors.DatabaseError.make({
        operation: "reportProcess",
        message: "Failed query: insert into process_stats",
      });
      const fake = Stores.fakeProcessStatsStore({ report: () => Effect.fail(refused) });
      const error = yield* Effect.gen(function* () {
        const store = yield* ProcessStats.ProcessStatsStore;
        return yield* Effect.flip(
          store.report("garage", "qemu", { jobs: 0, memoryBytes: 0, cpuPercent: 0 }),
        );
      }).pipe(Effect.provide(fake.layer));
      expect(error).toBe(refused);
      expect(fake.reports).toEqual([]);
    }),
  );
});
