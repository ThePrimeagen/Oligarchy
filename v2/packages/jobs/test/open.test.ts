import * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
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
  timedOut,
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

const BUSY = "POST https://api.linear.app/graphql: 503: busy";
const TIMED_OUT = "POST https://api.linear.app/graphql: no answer within 10000 ms";

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
  const { linear, asked, filed, described } = fakeLinear(given.linear);
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
  return { needs, asked, filed, described, lines, failed, linked, pinned };
};

const created = (...names: ReadonlyArray<string>) =>
  names.map((name) => `createTicket Omarchy: ${name} [3.4.0]`);

// The three steps that file one ticket, once Linear has created it.
const filedAs = (title: string, label: string, ticket: string) => [
  `createTicket ${title} [${label}]`,
  `setDescription ${ticket}`,
  `readyForAutomation ${ticket}`,
];

const never = async (): Promise<never> => {
  throw new Error("asked for a run it should not create");
};

describe("opening a test run", () => {
  it("opens one run and one job per definition but mint, each ticketed and handed off, in one line (happy)", async () => {
    const stores = await database();
    const { linear, asked, filed, described } = fakeLinear();
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
      ...filedAs("Omarchy: alpha", "3.4.0", "OLI-42"),
      ...filedAs("Omarchy: beta", "3.4.0", "OLI-43"),
    ]);
    expect(filed[0]).toEqual({ title: "Omarchy: alpha", label: "3.4.0" });
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

  it("fails the run and every job with a refusal of the first ticket, that same error, creating no more (error)", async () => {
    const refusal = refused("linear: no user prime@terminal.shop");
    const { needs, asked, failed } = filing({ linear: { createTicket: [jarl.err(refusal)] } });

    expect(errorOf(await open(needs, INPUT))).toBe(refusal);
    expect(asked).toEqual(created("alpha"));
    expect(failed).toEqual([
      { runId: "run-1", reason: refusal.message, resultIds: ["result-1", "result-2"] },
    ]);
  });

  it("says so in one line when the run will not take its failure, and the failure goes on (error)", async () => {
    const refusal = refused("linear: no team named Oligarchy");
    const { needs, lines } = filing({
      linear: { createTicket: [jarl.err(refusal)] },
      tests: { failRun: async () => jarl.err(refusedWrite("connection reset")) },
    });

    expect(errorOf(await open(needs, INPUT))).toBe(refusal);
    expect(lines).toEqual(["[ERROR] [global] failRun failed; run-1: connection reset"]);
  });

  it("fails a job whose create Linear did not answer alone, never sent again, and files the rest (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [ALPHA, BETA, GAMMA],
      linear: { createTicket: [undefined, jarl.err(unavailable())] },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = `${BUSY}; created OLI-42, OLI-44; failed beta`;
    expect(error).toMatchObject({ name: "HttpServerError", message: reason, status: 503 });
    expect(Linear.retryable(error)).toBe(true);
    expect(asked.filter((call) => call.startsWith("createTicket"))).toEqual(
      created("alpha", "beta", "gamma"),
    );
    expect(asked).toContain("readyForAutomation OLI-44");
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-2"] }]);
    expect(lines).toEqual([]);
  });

  it("stops the suite at a second create in a row Linear did not answer (error)", async () => {
    const { needs, asked, failed } = filing({
      definitions: [ALPHA, BETA, GAMMA, definitionRow(4, "delta")],
      linear: {
        createTicket: [undefined, jarl.err(unavailable()), jarl.err(timedOut())],
      },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = `${TIMED_OUT}; created OLI-42; failed beta, gamma, delta`;
    expect(error).toMatchObject({ name: "HttpTimedOut", message: reason });
    expect(asked.filter((call) => call.startsWith("createTicket"))).toEqual(
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
        createTicket: [
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

  it("moves a ticket whose description Linear refused to Errored, and stops the suite, naming the tickets and definitions (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [ALPHA, BETA, GAMMA],
      linear: {
        setDescription: [undefined, jarl.err(refused("linear: describing OLI-43 failed"))],
      },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = "linear: describing OLI-43 failed; created OLI-42, OLI-43; failed beta, gamma";
    expect(error).toMatchObject({ name: "LinearError", message: reason });
    expect(asked.slice(3)).toEqual([
      ...created("beta"),
      "setDescription OLI-43",
      "markErrored OLI-43: filing errored; linear: describing OLI-43 failed",
    ]);
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-2", "result-3"] }]);
    expect(lines).toEqual([
      "[ERROR] [OLI-43] ticket filing failed; linear: describing OLI-43 failed",
    ]);
  });

  it("moves a ticket Linear did not answer readying to Errored, never sent again, and files the rest (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [ALPHA, BETA, GAMMA],
      linear: { readyForAutomation: [undefined, jarl.err(unavailable())] },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = `${BUSY}; created OLI-42, OLI-43, OLI-44; failed beta`;
    expect(error).toMatchObject({ name: "HttpServerError", message: reason });
    expect(asked.filter((call) => call === "readyForAutomation OLI-43")).toHaveLength(1);
    expect(asked).toContain(`markErrored OLI-43: filing errored; ${BUSY}`);
    expect(asked).toContain("readyForAutomation OLI-44");
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-2"] }]);
    expect(lines).toEqual([`[ERROR] [OLI-43] ticket filing failed; ${BUSY}`]);
  });

  it("says in one line that a ticket stands wherever it was when its move to Errored fails too (error)", async () => {
    const { needs, lines } = filing({
      definitions: [ALPHA],
      linear: {
        setDescription: [jarl.err(refused("linear: describing OLI-42 failed"))],
        markErrored: [jarl.err(refused("linear: moving OLI-42 to Errored failed"))],
      },
    });

    errorOf(await open(needs, INPUT));

    expect(lines).toEqual([
      "[ERROR] [OLI-42] ticket filing failed; linear: describing OLI-42 failed; move to Errored failed: linear: moving OLI-42 to Errored failed",
    ]);
  });

  it("moves the ticket to Errored and names it when its Linear id write fails (error)", async () => {
    const failure = refusedWrite("connection reset");
    const { needs, asked, failed, lines } = filing({
      tests: { setLinearId: async () => jarl.err(failure) },
    });

    const error = errorOf(await open(needs, INPUT));

    const reason = `${failure.message}; created OLI-42`;
    expect(error).toMatchObject({ name: "DatabaseError", message: reason });
    expect(error.cause).toBe(failure.cause);
    expect(asked).toEqual([
      ...created("alpha"),
      "markErrored OLI-42: filing errored; connection reset",
    ]);
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1", "result-2"] }]);
    expect(lines).toEqual(["[ERROR] [OLI-42] ticket filing failed; connection reset"]);
  });

  it("moves the ticket to Errored and names it when its template will not render (error)", async () => {
    const { needs, asked, failed, lines } = filing({ files: {} });

    const error = errorOf(await open(needs, INPUT));

    const why = "prompt: ENOENT: no such file or directory, open 'prompts/linear-issue.html'";
    expect(error).toMatchObject({ name: "PromptError", message: `${why}; created OLI-42` });
    expect(failed.map((each) => each.reason)).toEqual([`${why}; created OLI-42`]);
    expect(asked).toContain(`markErrored OLI-42: filing errored; ${why}`);
    expect(lines).toEqual([`[ERROR] [OLI-42] ticket filing failed; ${why}`]);
  });

  it("fails a single test whose create was not answered with that bare error (error)", async () => {
    const lost = unavailable();
    const { needs, failed } = filing({
      definitions: [ALPHA],
      linear: { createTicket: [jarl.err(lost)] },
    });

    expect(errorOf(await open(needs, INPUT))).toBe(lost);
    expect(failed).toEqual([{ runId: "run-1", reason: BUSY, resultIds: ["result-1"] }]);
  });
});

const MINT_INPUT = { iso: ISO, serverUrl: SERVER_URL, pinned: QEMU_1 };

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
    expect(asked).toEqual(filedAs(`Omarchy mint: ${QEMU_1}`, "mint", "OLI-42"));
    expect(described.get("OLI-42")).toContain(
      `<p>OLI-42 mint on ${QEMU_1} run ${opened.id} result ${opened.result}</p>`,
    );
    expect(lines).toEqual([]);
  });

  it("opens no run with no mint definition (error)", async () => {
    const { needs, asked } = filing({ definitions: [ALPHA], tests: { createRun: never } });

    const missing = errorOf(await openMint(needs, MINT_INPUT));

    expect(jarl.error.is(missing, Errors.NoDefinition)).toBe(true);
    expect(missing.message).toBe(
      "mint: no test definition named mint; define the install once with ./ctrl test define --name mint",
    );
    expect(asked).toEqual([]);
  });

  it("fails the run it opened when Linear refuses the ticket, with that same error (error)", async () => {
    const refusal = refused("linear: no team named Oligarchy");
    const { needs, failed } = filing({
      definitions: [MINT],
      linear: { createTicket: [jarl.err(refusal)] },
    });

    expect(errorOf(await openMint(needs, MINT_INPUT))).toBe(refusal);
    expect(failed).toEqual([{ runId: "run-1", reason: refusal.message, resultIds: ["result-1"] }]);
  });

  it("is SetupGone for a setup row gone before the pin, and its ticket moves to Errored (error)", async () => {
    const { needs, asked, failed, lines } = filing({
      definitions: [MINT],
      setupRequests: { setResult: async () => jarl.ok(false) },
    });

    const error = errorOf(await openMint(needs, MINT_INPUT));

    const reason = "setup row gone before its result was stored; created OLI-42";
    expect(jarl.error.is(error, Errors.SetupGone)).toBe(true);
    expect(error.message).toBe(reason);
    expect(asked).toEqual([
      `createTicket Omarchy mint: ${QEMU_1} [mint]`,
      "markErrored OLI-42: filing errored; setup row gone before its result was stored",
    ]);
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1"] }]);
    expect(lines).toEqual([
      "[ERROR] [OLI-42] ticket filing failed; setup row gone before its result was stored",
    ]);
  });
});

const MINTS_INPUT = { iso: ISO, serverUrl: SERVER_URL, definition: MINT };

describe("opening a mint per server for ./ctrl mint", () => {
  it("opens one pinned run, job and ticket per server, in one line (happy)", async () => {
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
    expect(asked).toEqual([
      ...filedAs(`Omarchy mint: ${QEMU_1}`, "mint", "OLI-42"),
      ...filedAs(`Omarchy mint: ${QEMU_2}`, "mint", "OLI-43"),
    ]);
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
    expect(asked.filter((call) => call.startsWith("createTicket"))).toEqual([
      `createTicket Omarchy mint: ${QEMU_1} [mint]`,
      `createTicket Omarchy mint: ${QEMU_2} [mint]`,
    ]);
    expect(asked).toContain(
      `markErrored OLI-43: filing errored; ${QEMU_2} is held by a mint still being created or run`,
    );
    expect(failed).toEqual([{ runId: "run-2", reason, resultIds: ["result-2"] }]);
  });

  it("fails the run whose lock write fails, and its ticket moves to Errored (error)", async () => {
    const failure = refusedWrite("connection reset");
    const { needs, asked, failed } = filing({
      setupRequests: { claim: async () => jarl.err(failure) },
    });

    const error = errorOf(await openMints(needs, { ...MINTS_INPUT, servers: [QEMU_1] }));

    const reason = `${failure.message}; created OLI-42`;
    expect(error).toMatchObject({ name: "DatabaseError", message: reason });
    expect(asked).toEqual([
      `createTicket Omarchy mint: ${QEMU_1} [mint]`,
      "markErrored OLI-42: filing errored; connection reset",
    ]);
    expect(failed).toEqual([{ runId: "run-1", reason, resultIds: ["result-1"] }]);
  });
});
