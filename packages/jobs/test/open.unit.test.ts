import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Deferred, Effect, Fiber, FileSystem, Layer, Option } from "effect";
import { TestConsole } from "effect/testing";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as Open from "../src/open.ts";
import * as Templates from "../src/templates.ts";
import * as H from "./harness.ts";

const SERVER = "https://qemu.example.com";
const ISO = "https://example.com/omarchy.iso";
const PINNED = "http://10.0.0.6:42069";

const install = { ...H.definition(1, "Install Omarchy"), instruction: "Complete the installer" };
const terminal = H.definition(2, "Open a terminal");
// A second wording of install: same name, higher id, so it is the one a run pins from now on.
const installRevised = { ...install, id: 3, instruction: "Complete the installer, then log in" };
const mint = H.definition(8, "mint");

const suite = { serverUrl: SERVER, iso: ISO, version: "1.2.3", name: Option.none<string>() };
const named = (name: string) => ({ ...suite, name: Option.some(name) });

// The pin the proxy's setup row takes, as SetupRequestStore.setResult answers it.
const setupStore = (stored: boolean) => {
  const pins: Array<{ readonly iso: string; readonly serverUrl: string; readonly resultId: string }> =
    [];
  const unexpected = (member: string) => Effect.die(`Unexpected SetupRequestStore.${member}`);
  return {
    pins,
    layer: Layer.succeed(SetupRequests.SetupRequestStore)(
      SetupRequests.SetupRequestStore.of({
        insert: () => unexpected("insert"),
        setResult: (iso, serverUrl, resultId) =>
          Effect.sync(() => {
            pins.push({ iso, serverUrl, resultId });
            return stored;
          }),
        remove: () => unexpected("remove"),
        removeServer: () => unexpected("removeServer"),
        serverForResult: () => unexpected("serverForResult"),
        list: () => unexpected("list"),
        inspect: () => unexpected("inspect"),
      }),
    ),
  };
};

// The checkout's templates, or one template for every prompt file with the matched ones unreadable.
const services = (h: H.Harness, fs: Layer.Layer<FileSystem.FileSystem> = NodeFileSystem.layer) =>
  Layer.mergeAll(h.layer, fs, setupStore(true).layer);

const promptFs = (unreadable: RegExp, template: string) =>
  FileSystem.layerNoop({
    readFileString: (path) =>
      unreadable.test(path) ? Effect.fail(H.permissionDenied(path)) : Effect.succeed(template),
  });

const rendered = (values: Templates.Values) =>
  Templates.renderLinearIssue(values).pipe(Effect.provide(NodeFileSystem.layer));

const methods = (h: H.Harness) => h.linear.calls.map((call) => call.method);

describe("Open.open happy path", () => {
  it.effect("the suite opens one run, one result per newest wording but mint, and one ticket each", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(terminal, install, installRevised, mint);
      const opened = yield* Open.open(suite).pipe(Effect.provide(services(h)));

      const [run] = h.tests.runs;
      expect(run).toMatchObject({ iso: ISO, serverUrl: SERVER, status: "pending", reason: null });
      const results = h.tests.results;
      expect(results.map((row) => [row.runId, row.definitionId, row.status, row.linearId])).toEqual([
        [run?.id, installRevised.id, "pending", "OLI-42"],
        [run?.id, terminal.id, "pending", "OLI-43"],
      ]);
      const body = (definition: typeof install, index: number, identifier: string) =>
        rendered({
          LINEAR_TICKET: identifier,
          RUN_ID: run?.id ?? "",
          RESULT_ID: results[index]?.id ?? "",
          VERSION: "1.2.3",
          ISO_URL: ISO,
          SERVER_URL: SERVER,
          TEST_NAME: definition.name,
          TEST_DESCRIPTION: definition.description,
          TEST_INSTRUCTION: definition.instruction,
          TEST_PROOF: definition.proof,
        });
      const labels = [TestingLinear.labelId("agent test"), TestingLinear.labelId("1.2.3")];
      const created = (title: string) => ({
        method: "createIssue",
        input: {
          teamId: TestingLinear.TEAM_ID,
          title,
          labelIds: labels,
          assigneeId: TestingLinear.USER_ID,
          stateId: TestingLinear.STATES.backlog,
        },
      });
      // Each ticket is born in Backlog and moves to Automation Needed with its body, in one
      // update, so the automation server's webhook finds the result's Linear id already written.
      expect(h.linear.calls).toEqual([
        { method: "teamId" },
        { method: "labelIds", teamId: TestingLinear.TEAM_ID, version: "1.2.3" },
        { method: "assigneeId" },
        { method: "stateIds", teamId: TestingLinear.TEAM_ID },
        created("Omarchy: Install Omarchy"),
        {
          method: "describeIssue",
          ticket: TestingLinear.ticketFor("OLI-42"),
          description: yield* body(installRevised, 0, "OLI-42"),
          stateId: TestingLinear.STATES.automationNeeded,
        },
        created("Omarchy: Open a terminal"),
        {
          method: "describeIssue",
          ticket: TestingLinear.ticketFor("OLI-43"),
          description: yield* body(terminal, 1, "OLI-43"),
          stateId: TestingLinear.STATES.automationNeeded,
        },
      ]);
      expect(opened).toEqual({
        id: run?.id,
        tests: [
          { id: results[0]?.id, linear: TestingLinear.ticketFor("OLI-42") },
          { id: results[1]?.id, linear: TestingLinear.ticketFor("OLI-43") },
        ],
      });
      expect(h.log.lines).toEqual([
        {
          level: "info",
          text: `test ${run?.id} created; 2 tests; OLI-42, OLI-43`,
          location: undefined,
          agentId: undefined,
          cause: undefined,
        },
      ]);
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );

  it.effect("a name opens one result and one ticket, from that name's newest wording", () =>
    Effect.gen(function* () {
      const h = H.harness();
      // The older wording is listed last, so the newest wins by id, not by position.
      h.tests.definitions.push(installRevised, terminal, install);
      const opened = yield* Open.open(named("Install Omarchy")).pipe(Effect.provide(services(h)));
      expect(h.tests.results.map((row) => row.definitionId)).toEqual([installRevised.id]);
      const described = h.linear.calls.flatMap((call) =>
        call.method === "describeIssue" ? [call.description] : [],
      );
      expect(described).toHaveLength(1);
      expect(described[0]).toContain(installRevised.instruction);
      expect(described[0]).not.toContain(`<instruction>${install.instruction}</instruction>`);
      expect(opened.tests).toEqual([
        { id: h.tests.results[0]?.id, linear: TestingLinear.ticketFor("OLI-42") },
      ]);
    }),
  );

  it.effect("a name may open the mint definition the suite leaves out", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(install, mint);
      yield* Open.open(named("mint")).pipe(Effect.provide(services(h)));
      expect(h.tests.results.map((row) => row.definitionId)).toEqual([mint.id]);
      expect(
        h.linear.calls.flatMap((call) => (call.method === "createIssue" ? [call.input.title] : [])),
      ).toEqual(["Omarchy: mint"]);
    }),
  );
});

describe("Open.open unhappy path", () => {
  it.effect("an unknown name, an empty table, or a suite of only mint is refused before Linear", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(install);
      const unknown = yield* Open.open(named("Change lighting")).pipe(
        Effect.provide(services(h)),
        Effect.flip,
      );
      expect(unknown).toMatchObject({
        _tag: "CommandError",
        message: "test: no test definition named Change lighting",
      });

      const empty = H.harness();
      const none = yield* Open.open(suite).pipe(Effect.provide(services(empty)), Effect.flip);
      expect(none).toMatchObject({ _tag: "CommandError", message: "test: no test definitions found" });

      const minted = H.harness();
      minted.tests.definitions.push(mint);
      const onlyMint = yield* Open.open(suite).pipe(Effect.provide(services(minted)), Effect.flip);
      expect(onlyMint).toMatchObject({
        _tag: "CommandError",
        message: "test: no test definitions found",
      });

      for (const refused of [h, empty, minted]) {
        expect(refused.tests.runs).toEqual([]);
        expect(refused.linear.calls).toEqual([]);
      }
    }),
  );

  it.effect("Linear refusing before any ticket fails the run and every result with the reason", () =>
    Effect.gen(function* () {
      const refused = LinearErrors.LinearError.make({
        operation: "teamId",
        status: 401,
        message: "linear: request failed (401): unauthorized",
      });
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { teamId: Effect.fail(refused) } }),
      });
      h.tests.definitions.push(install, terminal);
      const error = yield* Open.open(suite).pipe(Effect.provide(services(h)), Effect.flip);
      expect(error).toBe(refused);
      expect(h.tests.runs[0]).toMatchObject({ status: "failed", reason: refused.message });
      expect(h.tests.results.map((row) => [row.status, row.reason])).toEqual([
        ["failed", refused.message],
        ["failed", refused.message],
      ]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("a hand-off that fails names every ticket created, and reports the one left in Backlog", () =>
    Effect.gen(function* () {
      const refused = LinearErrors.LinearError.make({
        operation: "describeIssue",
        status: 401,
        message: "linear: request failed (401): unauthorized",
      });
      const h = H.harness({
        linear: TestingLinear.fakeLinear({
          overrides: {
            describeIssue: (ticket) =>
              ticket.id === "issue-OLI-43" ? Effect.fail(refused) : Effect.void,
          },
        }),
      });
      h.tests.definitions.push(install, terminal);
      const error = yield* Open.open(suite).pipe(Effect.provide(services(h)), Effect.flip);
      const reason = `${refused.message}; created OLI-42, OLI-43`;
      expect(error).toMatchObject({
        _tag: "LinearError",
        operation: "describeIssue",
        status: 401,
        message: reason,
      });
      expect(h.tests.runs[0]?.reason).toBe(reason);
      expect(h.tests.results.map((row) => [row.status, row.linearId])).toEqual([
        ["failed", "OLI-42"],
        ["failed", "OLI-43"],
      ]);
      // OLI-42 was handed to automation; OLI-43 never left Backlog, and nobody would drive it.
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: `ticket trapped in Backlog; ${refused.message}`,
          location: undefined,
          agentId: "OLI-43",
          cause: refused,
        },
      ]);
    }),
  );

  it.effect("a Linear id another result holds traps the new ticket and names it", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(install);
      // The fake refuses a second result with the same linear_id, as the unique index does.
      H.seedResult(h.tests, { id: "33333333-3333-4333-8333-333333333333", linearId: "OLI-42" });
      const error = yield* Open.open(named("Install Omarchy")).pipe(
        Effect.provide(services(h)),
        Effect.flip,
      );
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "setLinearId",
        message: expect.stringMatching(/; created OLI-42$/),
      });
      expect(methods(h)).toEqual(["teamId", "labelIds", "assigneeId", "stateIds", "createIssue"]);
      expect(h.tests.runs[0]?.status).toBe("failed");
      expect(h.log.lines).toEqual([
        expect.objectContaining({
          level: "error",
          text: expect.stringMatching(/^ticket trapped in Backlog; (?!.*created OLI-42)/),
          agentId: "OLI-42",
          cause: expect.objectContaining({ _tag: "DatabaseError", operation: "setLinearId" }),
        }),
      ]);
    }),
  );

  it.effect("an interrupt while a ticket is handed off reports it left in Backlog", () =>
    Effect.gen(function* () {
      const reached = yield* Deferred.make<void>();
      const h = H.harness({
        linear: TestingLinear.fakeLinear({
          overrides: {
            describeIssue: () =>
              Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)),
          },
        }),
      });
      h.tests.definitions.push(install);
      const opening = yield* Open.open(named("Install Omarchy")).pipe(
        Effect.provide(services(h)),
        Effect.forkChild,
      );
      yield* Deferred.await(reached);
      yield* Fiber.interrupt(opening);
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: "ticket trapped in Backlog; interrupted",
          location: undefined,
          agentId: "OLI-42",
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("an unreadable guide or an unrenderable template is a PromptError naming the ticket", () =>
    Effect.gen(function* () {
      const unreadable = H.harness();
      unreadable.tests.definitions.push(install, terminal);
      const guide = yield* Open.open(suite).pipe(
        Effect.provide(
          services(unreadable, promptFs(/\/client\.md$/, "{{LINEAR_TICKET}} {{CLIENT_MD}}")),
        ),
        Effect.flip,
      );
      expect(guide).toMatchObject({
        _tag: "PromptError",
        message: expect.stringMatching(/^prompt: .*client\.md.*; created OLI-42$/),
        cause: expect.anything(),
      });
      expect(methods(unreadable)).toEqual([
        "teamId",
        "labelIds",
        "assigneeId",
        "stateIds",
        "createIssue",
      ]);
      expect(unreadable.tests.results.map((row) => row.status)).toEqual(["failed", "failed"]);

      const unrenderable = H.harness();
      unrenderable.tests.definitions.push(install);
      const template = yield* Open.open(named("Install Omarchy")).pipe(
        Effect.provide(services(unrenderable, promptFs(/never/, "{{RUN_ID}} {{NOPE}}"))),
        Effect.flip,
      );
      const message = "prompt: prompts/linear-issue.html uses {{NOPE}}, which has no value";
      expect(template).toMatchObject({ _tag: "PromptError", message: `${message}; created OLI-42` });
      expect(unrenderable.tests.runs[0]).toMatchObject({
        status: "failed",
        reason: `${message}; created OLI-42`,
      });
      // The trapped line carries the failure itself, not the run's reason with the ticket list.
      expect(unrenderable.log.lines.map((line) => [line.level, line.text, line.agentId])).toEqual([
        ["error", `ticket trapped in Backlog; ${message}`, "OLI-42"],
      ]);
    }),
  );
});

describe("Open.openMint happy path", () => {
  it.effect("opens the mint run, pins its result to the server, then hands its ticket off", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(install, mint);
      const setup = setupStore(true);
      const opened = yield* Open.openMint({ iso: ISO, serverUrl: SERVER, pinned: PINNED }).pipe(
        Effect.provide(Layer.mergeAll(h.layer, NodeFileSystem.layer, setup.layer)),
      );
      const [run] = h.tests.runs;
      const [result] = h.tests.results;
      expect(run).toMatchObject({ iso: ISO, serverUrl: SERVER, status: "pending" });
      expect(result).toMatchObject({ definitionId: mint.id, linearId: "OLI-42" });
      expect(setup.pins).toEqual([{ iso: ISO, serverUrl: PINNED, resultId: result?.id }]);
      const description = yield* Templates.renderMintIssue({
        LINEAR_TICKET: "OLI-42",
        RUN_ID: run?.id ?? "",
        RESULT_ID: result?.id ?? "",
        ISO_URL: ISO,
        SERVER_URL: SERVER,
        PINNED_SERVER: PINNED,
        INSTALL_NAME: mint.name,
        INSTALL_DESCRIPTION: mint.description,
        INSTALL_INSTRUCTION: mint.instruction,
        INSTALL_PROOF: mint.proof,
      }).pipe(Effect.provide(NodeFileSystem.layer));
      expect(h.linear.calls).toEqual([
        { method: "teamId" },
        { method: "labelIds", teamId: TestingLinear.TEAM_ID, version: "mint" },
        { method: "assigneeId" },
        { method: "stateIds", teamId: TestingLinear.TEAM_ID },
        {
          method: "createIssue",
          input: {
            teamId: TestingLinear.TEAM_ID,
            title: `Omarchy mint: ${PINNED}`,
            labelIds: [TestingLinear.labelId("agent test"), TestingLinear.labelId("mint")],
            assigneeId: TestingLinear.USER_ID,
            stateId: TestingLinear.STATES.backlog,
          },
        },
        {
          method: "describeIssue",
          ticket: TestingLinear.ticketFor("OLI-42"),
          description,
          stateId: TestingLinear.STATES.automationNeeded,
        },
      ]);
      expect(opened).toEqual({
        id: run?.id,
        result: result?.id,
        linear: TestingLinear.ticketFor("OLI-42"),
      });
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );
});

describe("Open.openMint unhappy path", () => {
  it.effect("no mint definition is refused before any run or ticket", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(install);
      const setup = setupStore(true);
      const error = yield* Open.openMint({ iso: ISO, serverUrl: SERVER, pinned: PINNED }).pipe(
        Effect.provide(Layer.mergeAll(h.layer, NodeFileSystem.layer, setup.layer)),
        Effect.flip,
      );
      expect(error).toMatchObject({
        _tag: "CommandError",
        message:
          "mint: no test definition named mint; define the install once with ./ctrl test define --name mint",
      });
      expect(h.tests.runs).toEqual([]);
      expect(h.linear.calls).toEqual([]);
      expect(setup.pins).toEqual([]);
    }),
  );

  it.effect("a setup row gone before the pin fails the run, names the ticket, and never queues it", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(mint);
      const setup = setupStore(false);
      const error = yield* Open.openMint({ iso: ISO, serverUrl: SERVER, pinned: PINNED }).pipe(
        Effect.provide(Layer.mergeAll(h.layer, NodeFileSystem.layer, setup.layer)),
        Effect.flip,
      );
      const reason = "setup row gone before its result was stored; created OLI-42";
      expect(error).toMatchObject({ _tag: "SetupGone", message: reason });
      expect(h.tests.runs[0]).toMatchObject({ status: "failed", reason });
      expect(methods(h)).toEqual(["teamId", "labelIds", "assigneeId", "stateIds", "createIssue"]);
      expect(h.log.lines.map((line) => [line.level, line.text, line.agentId])).toEqual([
        ["error", "ticket trapped in Backlog; setup row gone before its result was stored", "OLI-42"],
      ]);
    }),
  );
});
