import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as DbErrors from "@oligarchy/db/errors";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Setup from "../src/setup.ts";
import * as TestingLog from "@oligarchy/testing/log";

const ISO = "https://example.com/omarchy.iso";
const SERVER = "http://10.0.0.6:42069";
const PROXY = "http://127.0.0.1:42070";
const MINT = {
  id: 1,
  name: "mint",
  description: "install it",
  instruction: "boot the iso",
  proof: "the desktop",
  createdAt: new Date(0),
};

type Row = {
  iso: string;
  serverUrl: string;
  resultId: string | null;
  resultStatus: SetupRequests.ResultStatus | null;
  driveStatus: SetupRequests.DriveStatus | null;
};

const memory = () => {
  const rows: Array<Row> = [];
  let removed = 0;
  let failInsert = false;
  let failRemove = false;
  const key = (iso: string, serverUrl: string) =>
    rows.find((row) => row.iso === iso && row.serverUrl === serverUrl);
  const layer = Layer.succeed(SetupRequests.SetupRequestStore)(
    SetupRequests.SetupRequestStore.of({
      insert: (iso, serverUrl) =>
        Effect.sync(() => {
          if (failInsert) {
            return false;
          }
          if (key(iso, serverUrl) !== undefined) {
            return false;
          }
          rows.push({
            iso,
            serverUrl,
            resultId: null,
            resultStatus: null,
            driveStatus: null,
          });
          return true;
        }),
      setResult: (iso, serverUrl, resultId) =>
        Effect.sync(() => {
          const row = key(iso, serverUrl);
          if (row === undefined) {
            return false;
          }
          row.resultId = resultId;
          row.resultStatus = "pending";
          return true;
        }),
      remove: (iso, serverUrl) =>
        failRemove
          ? Effect.die(new Error("unlock failed"))
          : Effect.sync(() => {
              const index = rows.findIndex((row) => row.iso === iso && row.serverUrl === serverUrl);
              if (index >= 0) {
                rows.splice(index, 1);
                removed += 1;
              }
            }),
      removeServer: (serverUrl) =>
        Effect.sync(() => {
          const before = rows.length;
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (rows[index]?.serverUrl === serverUrl) {
              rows.splice(index, 1);
            }
          }
          return before - rows.length;
        }),
      serverForResult: (resultId) =>
        Effect.sync(() => {
          const row = rows.find((candidate) => candidate.resultId === resultId);
          return row === undefined ? Option.none() : Option.some(row.serverUrl);
        }),
      list: () =>
        Effect.sync(() => rows.map((row) => ({ iso: row.iso, serverUrl: row.serverUrl }))),
      inspect: (iso, serverUrl) =>
        Effect.sync(() => {
          const row = key(iso, serverUrl);
          return row === undefined ? Option.none() : Option.some({ ...row });
        }),
    }),
  );
  return {
    rows,
    get removed() {
      return removed;
    },
    set failInsert(value: boolean) {
      failInsert = value;
    },
    set failRemove(value: boolean) {
      failRemove = value;
    },
    layer,
  };
};

const provide = (
  store: ReturnType<typeof memory>,
  tests = TestingStores.fakeTestStore({ definitions: [MINT] }),
  linear = TestingLinear.fakeLinear(),
  log = TestingLog.fakeLog(),
) => Layer.mergeAll(store.layer, tests.layer, linear.layer, log.layer, NodeFileSystem.layer);

describe("decide", () => {
  const row = (patch: Partial<SetupRequests.Situation>): Option.Option<SetupRequests.Situation> =>
    Option.some({
      iso: ISO,
      serverUrl: SERVER,
      resultId: "result",
      resultStatus: "pending",
      driveStatus: null,
      ...patch,
    });

  it("a missing row is gone, before any status is read", () => {
    expect(Setup.decide(Option.none())).toBe("gone");
  });

  it("a passed result is done and the row stays out of the loop", () => {
    expect(Setup.decide(row({ resultStatus: "passed" }))).toBe("done");
  });

  it("a failed, errored, aborted, timed out or unjudged result releases the lock (unhappy)", () => {
    expect(Setup.decide(row({ resultStatus: "failed" }))).toBe("release");
    expect(Setup.decide(row({ resultStatus: "errored" }))).toBe("release");
    expect(Setup.decide(row({ resultStatus: "aborted" }))).toBe("release");
    expect(Setup.decide(row({ resultStatus: "timed_out" }))).toBe("release");
    // Only a pass says the disk was minted; a completed install nobody judged may not have saved.
    expect(Setup.decide(row({ resultStatus: "completed" }))).toBe("release");
  });

  it("an open result whose drive already ended releases the lock (unhappy)", () => {
    expect(Setup.decide(row({ resultStatus: "running", driveStatus: "succeeded" }))).toBe(
      "release",
    );
    expect(Setup.decide(row({ resultStatus: "pending", driveStatus: "failed" }))).toBe("release");
    expect(Setup.decide(row({ resultStatus: "running", driveStatus: "completed" }))).toBe(
      "release",
    );
    expect(Setup.decide(row({ resultStatus: "running", driveStatus: "errored" }))).toBe("release");
  });

  it("a pending result with no finished drive is still in flight", () => {
    expect(Setup.decide(row({ resultStatus: "pending", driveStatus: null }))).toBe("keep");
    expect(Setup.decide(row({ resultStatus: "running", driveStatus: "running" }))).toBe("keep");
  });

  it("a row with no result yet is released (unhappy)", () => {
    expect(Setup.decide(row({ resultId: null, resultStatus: null }))).toBe("release");
  });

  it("a stored result that retention swept is done, so the lock is not minted again", () => {
    expect(Setup.decide(row({ resultId: "result", resultStatus: null }))).toBe("done");
  });
});

const harness = (
  definitions: ReadonlyArray<typeof MINT> = [MINT],
  linear: TestingLinear.FakeLinear = TestingLinear.fakeLinear(),
  testStore: Parameters<typeof TestingStores.fakeTestStore>[1] = {},
) => {
  const store = memory();
  const tests = TestingStores.fakeTestStore({ definitions }, testStore);
  const log = TestingLog.fakeLog();
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Setup.Setup.layer.pipe(Layer.provide(provide(store, tests, linear, log)))),
    );
  return { store, tests, linear, log, run };
};

describe("opening a setup", () => {
  it.effect("creates one mint ticket, and a second open while it is in flight does not", () => {
    const h = harness();
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.linear.calls.filter((call) => call.method === "createIssue")).toEqual([
          {
            method: "createIssue",
            input: {
              teamId: TestingLinear.TEAM_ID,
              title: `Omarchy mint: ${SERVER}`,
              labelIds: [TestingLinear.labelId("agent test"), TestingLinear.labelId("mint")],
              assigneeId: TestingLinear.USER_ID,
              stateId: TestingLinear.STATES.backlog,
            },
          },
        ]);
        expect(h.store.rows).toHaveLength(1);
        expect(h.store.rows[0]?.resultStatus).toBe("pending");
        expect(h.tests.results[0]?.linearId).toBe("OLI-42");
        expect(h.log.lines.map((line) => line.text)).toEqual([
          `setup ticket OLI-42; ${SERVER}; ${ISO}`,
        ]);
      }),
    );
  });

  it.effect("a passed setup is left in place and is not ticketed again", () => {
    const h = harness();
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        const row = h.store.rows[0];
        if (row !== undefined) {
          row.resultStatus = "passed";
        }
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.linear.calls.filter((call) => call.method === "createIssue")).toHaveLength(1);
        expect(h.store.rows).toHaveLength(1);
        expect(h.store.removed).toBe(0);
      }),
    );
  });

  it.effect("a failed setup is released and a new ticket is created (unhappy)", () => {
    const h = harness();
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        const row = h.store.rows[0];
        if (row !== undefined) {
          row.resultStatus = "failed";
        }
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.linear.calls.filter((call) => call.method === "createIssue")).toHaveLength(2);
        expect(h.store.rows).toHaveLength(1);
        expect(h.store.rows[0]?.resultStatus).toBe("pending");
      }),
    );
  });

  it.effect("no mint definition drops the lock and creates no ticket (unhappy)", () => {
    const h = harness([]);
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.linear.calls).toEqual([]);
        expect(h.store.rows).toHaveLength(0);
        expect(h.log.lines.map((line) => line.text)[0]).toContain("no test definition named mint");
      }),
    );
  });

  it.effect("a create still attaching its ticket is not released by the check (happy)", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const go = yield* Deferred.make<void>();
      let created = 0;
      const linear = TestingLinear.fakeLinear({
        overrides: {
          createIssue: () =>
            Effect.gen(function* () {
              created += 1;
              if (created === 1) {
                return TestingLinear.ticketFor("OLI-42");
              }
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(go);
              return TestingLinear.ticketFor("OLI-43");
            }),
        },
      });
      const other = "http://10.0.0.5:42069";
      const h = harness([MINT], linear);
      yield* h.run(
        Effect.gen(function* () {
          const setup = yield* Setup.Setup;
          yield* setup.install();
          yield* setup.open(ISO, SERVER, PROXY);
          const fiber = yield* Effect.forkChild(setup.open(ISO, other, PROXY));
          yield* Deferred.await(started);
          yield* TestClock.adjust("30 seconds");
          expect(h.store.rows.map((row) => row.serverUrl).sort()).toEqual([SERVER, other].sort());
          yield* Deferred.succeed(go, undefined);
          yield* Fiber.join(fiber);
        }),
      );
    }),
  );

  it.effect("a row whose ticket has not been stored yet is left for the timer (unhappy)", () => {
    const h = harness();
    h.store.rows.push({
      iso: ISO,
      serverUrl: SERVER,
      resultId: null,
      resultStatus: null,
      driveStatus: null,
    });
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.linear.calls).toEqual([]);
        expect(h.store.rows).toHaveLength(1);
        yield* TestClock.adjust("30 seconds");
        expect(h.store.rows).toHaveLength(0);
        expect(h.log.lines.map((line) => line.text)).toContain(
          `setup released; ${SERVER}; ${ISO}; no result`,
        );
      }),
    );
  });

  it.effect("an insert that fails never creates a ticket (unhappy)", () => {
    const h = harness();
    h.store.failInsert = true;
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.linear.calls).toEqual([]);
        expect(h.store.rows).toHaveLength(0);
      }),
    );
  });

  it.effect("a failed Linear ticket unlocks, and the issue is not watched (unhappy)", () => {
    const linear = TestingLinear.fakeLinear({
      overrides: {
        createIssue: () =>
          Effect.fail(
            LinearErrors.LinearError.make({
              operation: "createIssue",
              message: "linear: request failed",
            }),
          ),
      },
    });
    const h = harness([MINT], linear);
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        expect(h.store.rows).toHaveLength(0);
        expect(h.tests.runs[0]?.status).toBe("failed");
        expect(h.log.lines.map((line) => line.text)).toEqual([
          `setup ticket failed: linear: request failed; ${SERVER}; ${ISO}`,
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(h.store.removed).toBe(1);
      }),
    );
  });

  it.effect(
    "a run that will not take a failed ticket is a line, and the ticket's own failure unlocks (unhappy)",
    () => {
      const linear = TestingLinear.fakeLinear({
        overrides: {
          createIssue: () =>
            Effect.fail(
              LinearErrors.LinearError.make({
                operation: "createIssue",
                message: "linear: request failed",
              }),
            ),
        },
      });
      const h = harness([MINT], linear, {
        failRun: () =>
          Effect.fail(
            DbErrors.DatabaseError.make({
              operation: "failRun",
              message: "Failed query: update test_runs",
              cause: new Error("connection reset"),
            }),
          ),
      });
      return h.run(
        Effect.gen(function* () {
          const setup = yield* Setup.Setup;
          yield* setup.install();
          yield* setup.open(ISO, SERVER, PROXY);
          const [run] = h.tests.runs;
          expect(run?.status).toBe("pending");
          expect(h.store.rows).toHaveLength(0);
          expect(h.log.lines.map((line) => line.text)).toEqual([
            `failRun failed; ${run?.id ?? ""}: connection reset`,
            `setup ticket failed: linear: request failed; ${SERVER}; ${ISO}`,
          ]);
        }),
      );
    },
  );

  it.effect(
    "a lock deleted while its ticket is made fails the run and names the ticket left in Backlog (unhappy)",
    () => {
      const linear = TestingLinear.fakeLinear({
        overrides: {
          createIssue: () =>
            Effect.sync(() => {
              h.store.rows.splice(0);
              return TestingLinear.ticketFor("OLI-42");
            }),
        },
      });
      const h = harness([MINT], linear);
      return h.run(
        Effect.gen(function* () {
          const setup = yield* Setup.Setup;
          yield* setup.install();
          yield* setup.open(ISO, SERVER, PROXY);
          const reason = "setup row gone before its result was stored";
          expect(h.tests.runs[0]).toMatchObject({
            status: "failed",
            reason: `${reason}; created OLI-42`,
          });
          expect(h.linear.calls.map((call) => call.method)).not.toContain("describeIssue");
          expect(h.log.lines.map((line) => [line.level, line.text, line.agentId])).toEqual([
            ["error", `ticket trapped in Backlog; ${reason}`, "OLI-42"],
            [
              "error",
              `setup ticket failed: ${reason}; created OLI-42; ${SERVER}; ${ISO}`,
              undefined,
            ],
          ]);
        }),
      );
    },
  );

  it.effect(
    "a failed unlock after a failed Linear ticket leaves the row and does not mint again (unhappy)",
    () => {
      let created = 0;
      const linear = TestingLinear.fakeLinear({
        overrides: {
          createIssue: () =>
            Effect.gen(function* () {
              created += 1;
              return yield* Effect.fail(
                LinearErrors.LinearError.make({
                  operation: "createIssue",
                  message: "linear: request failed",
                }),
              );
            }),
        },
      });
      const h = harness([MINT], linear);
      h.store.failRemove = true;
      return h.run(
        Effect.gen(function* () {
          const setup = yield* Setup.Setup;
          yield* setup.install();
          yield* setup.open(ISO, SERVER, PROXY);
          expect(h.store.rows).toHaveLength(1);
          expect(h.store.rows[0]?.resultId).toBeNull();
          expect(
            h.log.lines
              .map((line) => line.text)
              .some((text) => text.includes("setup release failed")),
          ).toBe(true);
          yield* setup.open(ISO, SERVER, PROXY);
          expect(created).toBe(1);
        }),
      );
    },
  );

  it.effect("a reserve with no host drops the lock and creates no ticket (unhappy)", () => {
    const h = harness();
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, "");
        expect(h.linear.calls).toEqual([]);
        expect(h.store.rows).toHaveLength(0);
        expect(h.log.lines.map((line) => line.text)).toEqual([
          `setup ticket failed: reserve carried no host; ${SERVER}; ${ISO}`,
        ]);
      }),
    );
  });
});

describe("the setup timer", () => {
  it.effect("checks every 30 seconds and stops once nothing is still in flight", () => {
    const h = harness();
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        yield* TestClock.adjust("30 seconds");
        expect(h.store.rows).toHaveLength(1);
        const row = h.store.rows[0];
        if (row !== undefined) {
          row.resultStatus = "passed";
        }
        yield* TestClock.adjust("30 seconds");
        expect(h.store.removed).toBe(0);
        expect(h.store.rows).toHaveLength(1);
        // The timer is down: another interval does not look again.
        if (row !== undefined) {
          row.resultStatus = "failed";
        }
        yield* TestClock.adjust("30 seconds");
        expect(h.store.rows).toHaveLength(1);
        expect(h.store.rows[0]?.resultStatus).toBe("failed");
      }),
    );
  });

  it.effect("a row deleted before the tick is gone, and its status is not acted on", () => {
    const h = harness();
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        yield* setup.open(ISO, SERVER, PROXY);
        h.store.rows.splice(0, h.store.rows.length);
        yield* TestClock.adjust("30 seconds");
        expect(h.store.removed).toBe(0);
        expect(h.log.lines.some((line) => line.text.startsWith("setup released"))).toBe(false);
        // Nothing left to watch, so the next interval does not invent a release.
        yield* TestClock.adjust("30 seconds");
        expect(h.store.removed).toBe(0);
      }),
    );
  });

  it.effect(
    "a drive that already ended while the result is open releases the lock (unhappy)",
    () => {
      const h = harness();
      return h.run(
        Effect.gen(function* () {
          const setup = yield* Setup.Setup;
          yield* setup.install();
          yield* setup.open(ISO, SERVER, PROXY);
          const row = h.store.rows[0];
          if (row !== undefined) {
            row.driveStatus = "succeeded";
          }
          yield* TestClock.adjust("30 seconds");
          expect(h.store.rows).toHaveLength(0);
          expect(h.log.lines.map((line) => line.text)).toContain(
            `setup released; ${SERVER}; ${ISO}; pending`,
          );
        }),
      );
    },
  );

  it.effect("install starts the timer for a setup already in flight", () => {
    const h = harness();
    h.store.rows.push({
      iso: ISO,
      serverUrl: SERVER,
      resultId: "result",
      resultStatus: "running",
      driveStatus: "running",
    });
    return h.run(
      Effect.gen(function* () {
        const setup = yield* Setup.Setup;
        yield* setup.install();
        const row = h.store.rows[0];
        if (row !== undefined) {
          row.resultStatus = "failed";
        }
        yield* TestClock.adjust("30 seconds");
        expect(h.store.rows).toHaveLength(0);
      }),
    );
  });
});
