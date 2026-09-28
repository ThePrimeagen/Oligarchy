import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Errors from "../src/errors.ts";
import type { Needs } from "../src/needs.ts";
import { open, openMint, openMints } from "../src/open.ts";
import {
  database,
  define,
  definitionRow,
  errorOf,
  fakeLinear,
  fakePrompts,
  fakeTests,
  ISO,
  logging,
  only,
  refused,
  refusedWrite,
  type Script,
  SERVER_URL,
  STATES,
  unavailable,
} from "./support.ts";

const INPUT = { serverUrl: SERVER_URL, iso: ISO, version: "3.4.0" };
const QEMU_1 = "http://qemu-1:9000";
const QEMU_2 = "http://qemu-2:9000";
const QEMU_3 = "http://qemu-3:9000";

const ALPHA = definitionRow(1, "alpha");
const BETA = definitionRow(2, "beta");
const GAMMA = definitionRow(3, "gamma");
const MINT = definitionRow(9, "mint");

const BUSY = "linear: request failed (503): busy";

// Every need opening has, faked: the tests store over `definitions`, a Linear that answers, the
// prompts, and setup rows that take their pin, unless a test says otherwise.
const filing = (
  given: {
    readonly definitions?: ReadonlyArray<Stores.Tests.DefinitionRow>;
    readonly tests?: Partial<Needs["tests"]>;
    readonly setupRequests?: Partial<Needs["setupRequests"]>;
    readonly linear?: Script;
    readonly files?: Readonly<Record<string, string>>;
  } = {},
) => {
  const { tests, failed, linked } = fakeTests(given.definitions ?? [ALPHA, BETA], given.tests);
  const { linear, asked, created, described } = fakeLinear(given.linear);
  const { prompts } = fakePrompts(given.files);
  const { lines, logger } = logging();
  const pinned: Array<string> = [];
  const pin = async (iso: string, server: string, result: string) => {
    pinned.push(`${server} ${result}`);
    return jarl.ok(iso === ISO);
  };
  const needs = {
    tests,
    linear,
    logger,
    prompts,
    setupRequests: only<Needs["setupRequests"]>({
      setResult: pin,
      claim: pin,
      ...given.setupRequests,
    }),
  };
  return { needs, asked, created, described, lines, failed, linked, pinned };
};

const created = (...identifiers: ReadonlyArray<string>) =>
  identifiers.map((identifier) => `createIssue Omarchy: ${identifier}`);

const TEAM = ["teamId", "labelIds 3.4.0", "assigneeId", "stateIds"];

const never = async (): Promise<never> => {
  throw new Error("asked for a run it should not create");
};

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a test run", () => {
  it("opens one run and one job per definition but mint, each ticketed and handed off, in one line (happy)", async () => {
    const stores = await database();
    const { linear, asked, created: inputs, described } = fakeLinear();
    const { lines, logger } = logging();
    const { prompts } = fakePrompts();
    await define(stores, "alpha");
    await define(stores, "beta");
    await define(stores, "mint");

    const opened = jarl.unwrap(await open({ ...stores, linear, logger, prompts }, INPUT));

    const [alpha, beta] = opened.tests;
    expect(opened.tests.map((test) => test.linear.identifier)).toEqual(["OLI-42", "OLI-43"]);
    expect(jarl.unwrap(await stores.tests.findResultByLinearId("OLI-42"))).toMatchObject({
      id: alpha?.id,
      runId: opened.id,
      status: "pending",
    });
    expect(jarl.unwrap(await stores.tests.findResultByLinearId("OLI-43"))?.id).toBe(beta?.id);
    expect(asked).toEqual([
      ...TEAM,
      "createIssue Omarchy: alpha",
      "describeIssue OLI-42 state-automation-needed",
      "createIssue Omarchy: beta",
      "describeIssue OLI-43 state-automation-needed",
    ]);
    expect(inputs[0]).toEqual({
      teamId: "team-1",
      title: "Omarchy: alpha",
      labelIds: ["label-agent-test", "label-3.4.0"],
      assigneeId: "user-1",
      stateId: STATES.backlog,
    });
    expect(described.get("OLI-42")).toContain(
      `<p>OLI-42 alpha v3.4.0 run ${opened.id} result ${alpha?.id ?? ""}</p>`,
    );
    expect(lines).toEqual([`[INFO] [global] test ${opened.id} created; 2 tests; OLI-42, OLI-43`]);
  });

  it("refuses an unknown name, an empty table, or a table of only mint, before Linear (error)", async () => {
    const cases = [
      { definitions: [ALPHA], name: "wifi", message: "test: no test definition named wifi" },
      { definitions: [], name: undefined, message: "test: no test definitions found" },
      { definitions: [MINT], name: undefined, message: "test: no test definitions found" },
    ];
    for (const { definitions, name, message } of cases) {
      const { needs, asked } = filing({ definitions, tests: { createRun: never } });

      const error = errorOf(await open(needs, name === undefined ? INPUT : { ...INPUT, name }));

      expect(jarl.error.is(error, Errors.NoDefinition)).toBe(true);
      expect(error.message).toBe(message);
      expect(asked).toEqual([]);
    }
  });

  it("is the failure of a definitions read or a run write that fails, before Linear (error)", async () => {
    const failure = refusedWrite("connection reset");
    const listing = filing({ tests: { listTestDefinitions: async () => jarl.err(failure) } });
    const finding = filing({ tests: { findTestDefinition: async () => jarl.err(failure) } });
    const writing = filing({ tests: { createRun: async () => jarl.err(failure) } });

    expect(errorOf(await open(listing.needs, INPUT))).toBe(failure);
    expect(errorOf(await open(finding.needs, { ...INPUT, name: "alpha" }))).toBe(failure);
    expect(errorOf(await open(writing.needs, INPUT))).toBe(failure);
    expect([...listing.asked, ...finding.asked, ...writing.asked]).toEqual([]);
  });

  it("asks a team lookup Linear did not answer once again, and the run opens (error)", async () => {
    vi.useFakeTimers();
    const { needs, asked, failed } = filing({ linear: { teamId: [jarl.err(unavailable())] } });

    const opening = open(needs, INPUT);
    await vi.runAllTimersAsync();
    const opened = jarl.unwrap(await opening);

    expect(opened.tests).toHaveLength(2);
    expect(asked.slice(0, 2)).toEqual(["teamId", "teamId"]);
    expect(failed).toEqual([]);
  });

  it("does not ask a label lookup Linear did not answer again, and fails the run with it (error)", async () => {
    const lost = unavailable();
    const { needs, asked, failed } = filing({ linear: { labelIds: [jarl.err(lost)] } });

    expect(errorOf(await open(needs, INPUT))).toBe(lost);
    expect(asked).toEqual(["teamId", "labelIds 3.4.0"]);
    expect(failed).toEqual([{ runId: "run-1", reason: BUSY, resultIds: ["result-1", "result-2"] }]);
  });

  it("fails the run and every job with a refusal before any ticket, that same error (error)", async () => {
    const refusal = refused("linear: no user prime@terminal.shop");
    const { needs, failed } = filing({ linear: { assigneeId: [jarl.err(refusal)] } });

    expect(errorOf(await open(needs, INPUT))).toBe(refusal);
    expect(failed).toEqual([
      { runId: "run-1", reason: refusal.message, resultIds: ["result-1", "result-2"] },
    ]);
  });

  it("says so in one line when the run will not take its failure, and the failure goes on (error)", async () => {
    const refusal = refused("linear: no team named Oligarchy");
    const { needs, lines } = filing({
      linear: { teamId: [jarl.err(refusal)] },
      tests: { failRun: async () => jarl.err(refusedWrite("connection reset")) },
    });

    expect(errorOf(await open(needs, INPUT))).toBe(refusal);
    expect(lines).toEqual(["[ERROR] [global] failRun failed; run-1: connection reset"]);
  });

  it("fails a job whose create Linear did not answer alone, never sent again, and files the rest (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [ALPHA, BETA, GAMMA],
      linear: { createIssue: [undefined, jarl.err(unavailable())] },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = `${BUSY}; created OLI-42, OLI-44; failed beta`;
    expect(error).toMatchObject({ name: "LinearUnavailable", message: reason });
    expect(asked.filter((call) => call.startsWith("createIssue"))).toEqual(
      created("alpha", "beta", "gamma"),
    );
    expect(asked).toContain("describeIssue OLI-44 state-automation-needed");
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-2"] }]);
    expect(lines).toEqual([]);
  });

  it("stops the suite at a second create in a row Linear did not answer (error)", async () => {
    const { needs, asked, failed } = filing({
      definitions: [ALPHA, BETA, GAMMA, definitionRow(4, "delta")],
      linear: {
        createIssue: [
          undefined,
          jarl.err(unavailable()),
          jarl.err(unavailable("linear: request failed: no answer within 10 seconds")),
        ],
      },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason =
      "linear: request failed: no answer within 10 seconds; created OLI-42; failed beta, gamma, delta";
    expect(error).toMatchObject({ name: "LinearUnavailable", message: reason });
    expect(asked.filter((call) => call.startsWith("createIssue"))).toEqual(
      created("alpha", "beta", "gamma"),
    );
    expect(failed).toEqual([
      { runId: "run-1", reason, resultIds: ["result-2", "result-3", "result-4"] },
    ]);
  });

  it("stops at a refusal after a create Linear did not answer, naming what it created (error)", async () => {
    const { needs, failed } = filing({
      definitions: [ALPHA, BETA, GAMMA],
      linear: {
        createIssue: [
          undefined,
          jarl.err(unavailable()),
          jarl.err(refused("linear: issue creation failed")),
        ],
      },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = "linear: issue creation failed; created OLI-42; failed beta, gamma";
    expect(error).toMatchObject({ name: "LinearError", message: reason });
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-2", "result-3"] }]);
  });

  it("stops the suite at a refused hand-off, naming the tickets and definitions, in one trapped line (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [ALPHA, BETA, GAMMA],
      linear: {
        describeIssue: [undefined, jarl.err(refused("linear: describing OLI-43 failed"))],
      },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = "linear: describing OLI-43 failed; created OLI-42, OLI-43; failed beta, gamma";
    expect(error).toMatchObject({ name: "LinearError", message: reason });
    expect(asked.filter((call) => call.startsWith("createIssue"))).toEqual(
      created("alpha", "beta"),
    );
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-2", "result-3"] }]);
    expect(lines).toEqual([
      "[ERROR] [OLI-43] ticket trapped in Backlog; linear: describing OLI-43 failed",
    ]);
  });

  it("opens a ticket whose hand-off answer was lost but that left Backlog, as answered (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [ALPHA],
      linear: { describeIssue: [jarl.err(unavailable())] },
    });

    const opened = jarl.unwrap(await open(needs, INPUT));

    expect(opened.tests.map((test) => test.linear.identifier)).toEqual(["OLI-42"]);
    expect(asked.slice(-2)).toEqual([
      "describeIssue OLI-42 state-automation-needed",
      "issueStateId OLI-42",
    ]);
    expect(failed).toEqual([]);
    expect(lines).toEqual(["[INFO] [global] test run-1 created; 1 tests; OLI-42"]);
  });

  it("fails with the hand-off's own failure when its answer was lost and the ticket is still in Backlog, or its column will not read (error)", async () => {
    const lost = unavailable();
    const reason = `${BUSY}; created OLI-42`;
    for (const column of [jarl.ok(STATES.backlog), jarl.err(refused("linear: Entity not found"))]) {
      const { needs, failed, lines } = filing({
        definitions: [ALPHA],
        linear: { describeIssue: [jarl.err(lost)], issueStateId: [column] },
      });

      const error = errorOf(await open(needs, INPUT));

      expect(error).toMatchObject({ name: "LinearUnavailable", message: reason });
      expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1"] }]);
      expect(lines).toEqual([`[ERROR] [OLI-42] ticket trapped in Backlog; ${BUSY}`]);
    }
  });

  it("traps the ticket and names it when its Linear id write fails (error)", async () => {
    const failure = refusedWrite("connection reset");
    const { needs, asked, failed, lines } = filing({
      tests: { setLinearId: async () => jarl.err(failure) },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = `${failure.message}; created OLI-42`;
    expect(error).toMatchObject({ name: "DatabaseError", message: reason });
    expect(error.cause).toBe(failure.cause);
    expect(asked).not.toContain("describeIssue OLI-42 state-automation-needed");
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1", "result-2"] }]);
    expect(lines).toEqual(["[ERROR] [OLI-42] ticket trapped in Backlog; connection reset"]);
  });

  it("traps the ticket and names it when its template will not render (error)", async () => {
    const { needs, failed, lines } = filing({ files: {} });

    const error = errorOf(await open(needs, INPUT));

    const why = "prompt: ENOENT: no such file or directory, open 'prompts/linear-issue.html'";
    expect(error).toMatchObject({ name: "PromptError", message: `${why}; created OLI-42` });
    expect(failed.map((each) => each.reason)).toEqual([`${why}; created OLI-42`]);
    expect(lines).toEqual([`[ERROR] [OLI-42] ticket trapped in Backlog; ${why}`]);
  });

  it("fails a single test whose create was not answered with that bare error (error)", async () => {
    const lost = unavailable();
    const { needs, failed } = filing({
      definitions: [ALPHA],
      linear: { createIssue: [jarl.err(lost)] },
    });

    expect(errorOf(await open(needs, INPUT))).toBe(lost);
    expect(failed).toEqual([{ runId: "run-1", reason: BUSY, resultIds: ["result-1"] }]);
  });
});

const MINT_INPUT = { iso: ISO, serverUrl: SERVER_URL, pinned: QEMU_1 };

const MINT_TEAM = ["teamId", "labelIds mint", "assigneeId", "stateIds"];

describe("opening a mint for the proxy", () => {
  it("pins its result on the setup row, then hands its ticket off (happy)", async () => {
    const stores = await database();
    const { linear, asked, described } = fakeLinear();
    const { lines, logger } = logging();
    const { prompts } = fakePrompts();
    await define(stores, "mint");
    jarl.unwrap(await stores.setupRequests.insert(ISO, QEMU_1));

    const opened = jarl.unwrap(await openMint({ ...stores, linear, logger, prompts }, MINT_INPUT));

    expect(opened.linear.identifier).toBe("OLI-42");
    expect(await stores.setupRequests.serverForResult(opened.result)).toEqual(jarl.ok(QEMU_1));
    expect(jarl.unwrap(await stores.tests.findResultByLinearId("OLI-42"))?.id).toBe(opened.result);
    expect(asked).toEqual([
      ...MINT_TEAM,
      `createIssue Omarchy mint: ${QEMU_1}`,
      "describeIssue OLI-42 state-automation-needed",
    ]);
    expect(described.get("OLI-42")).toContain(
      `<p>OLI-42 mint on ${QEMU_1} run ${opened.id} result ${opened.result}</p>`,
    );
    expect(lines).toEqual([]);
  });

  it("opens no run with no mint definition, or with Linear refusing the team (error)", async () => {
    const unminted = filing({ definitions: [ALPHA], tests: { createRun: never } });
    const refusal = refused("linear: no team named Oligarchy");
    const teamless = filing({
      definitions: [MINT],
      tests: { createRun: never },
      linear: { teamId: [jarl.err(refusal)] },
    });

    const missing = errorOf(await openMint(unminted.needs, MINT_INPUT));

    expect(jarl.error.is(missing, Errors.NoDefinition)).toBe(true);
    expect(missing.message).toBe(
      "mint: no test definition named mint; define the install once with ./ctrl test define --name mint",
    );
    expect(unminted.asked).toEqual([]);
    expect(errorOf(await openMint(teamless.needs, MINT_INPUT))).toBe(refusal);
  });

  it("is SetupGone for a setup row gone before the pin, and its ticket stays in Backlog (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [MINT],
      setupRequests: { setResult: async () => jarl.ok(false) },
    });

    const error = errorOf(await openMint(needs, MINT_INPUT));

    const reason = "setup row gone before its result was stored; created OLI-42";
    expect(jarl.error.is(error, Errors.SetupGone)).toBe(true);
    expect(error.message).toBe(reason);
    expect(asked).not.toContain("describeIssue OLI-42 state-automation-needed");
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1"] }]);
    expect(lines).toEqual([
      "[ERROR] [OLI-42] ticket trapped in Backlog; setup row gone before its result was stored",
    ]);
  });
});

const MINTS_INPUT = { iso: ISO, serverUrl: SERVER_URL, definition: MINT };

describe("opening a mint per server for ./ctrl mint", () => {
  it("opens one pinned run, job and ticket per server, the team asked once, in one line (happy)", async () => {
    const stores = await database();
    const { linear, asked } = fakeLinear();
    const { lines, logger } = logging();
    const { prompts } = fakePrompts();
    const definition = await define(stores, "mint");

    const opened = jarl.unwrap(
      await openMints(
        { ...stores, linear, logger, prompts },
        { ...MINTS_INPUT, definition: { ...MINT, id: definition.id }, servers: [QEMU_1, QEMU_2] },
      ),
    );

    expect(opened.map((mint) => [mint.server, mint.linear.identifier])).toEqual([
      [QEMU_1, "OLI-42"],
      [QEMU_2, "OLI-43"],
    ]);
    for (const mint of opened) {
      expect(await stores.setupRequests.serverForResult(mint.result)).toEqual(jarl.ok(mint.server));
    }
    expect(asked.filter((call) => MINT_TEAM.includes(call))).toEqual(MINT_TEAM);
    expect(lines).toEqual([`[INFO] [global] mint ${ISO} created; 2 servers; OLI-42, OLI-43`]);
  });

  it("opens nothing and asks nothing for no servers (error)", async () => {
    const { needs, asked, lines } = filing({ tests: { createRun: never } });

    expect(await openMints(needs, { ...MINTS_INPUT, servers: [] })).toEqual(jarl.ok([]));
    expect(asked).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("is SetupHeld for a lock a mint holds, stops the servers after it, and earlier runs stand (error)", async () => {
    const { needs, asked, failed } = filing({
      setupRequests: {
        claim: async (_iso, server) => jarl.ok(server !== QEMU_2),
      },
    });

    const error = errorOf(
      await openMints(needs, { ...MINTS_INPUT, servers: [QEMU_1, QEMU_2, QEMU_3] }),
    );

    const reason = `${QEMU_2} is held by a mint still being created or run; created OLI-42, OLI-43`;
    expect(jarl.error.is(error, Errors.SetupHeld)).toBe(true);
    expect(error.message).toBe(reason);
    expect(asked.filter((call) => call.startsWith("createIssue"))).toEqual([
      `createIssue Omarchy mint: ${QEMU_1}`,
      `createIssue Omarchy mint: ${QEMU_2}`,
    ]);
    expect(failed).toEqual([{ runId: "run-2", reason, resultIds: ["result-2"] }]);
  });

  it("fails the run whose lock write fails, and its ticket never leaves Backlog (error)", async () => {
    const failure = refusedWrite("connection reset");
    const { needs, asked, failed } = filing({
      setupRequests: { claim: async () => jarl.err(failure) },
    });

    const error = errorOf(await openMints(needs, { ...MINTS_INPUT, servers: [QEMU_1] }));

    const reason = `${failure.message}; created OLI-42`;
    expect(error).toMatchObject({ name: "DatabaseError", message: reason });
    expect(asked).not.toContain("describeIssue OLI-42 state-automation-needed");
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1"] }]);
  });
});
