import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem, NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Layer } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { CliError, Command } from "effect/unstable/cli";
import * as CtrlCommand from "../../src/ctrl/command.ts";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Api from "../../src/shared/api.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Config from "../support/config.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const SERVER = "https://qemu.example.com";
const NOW = Date.parse("2026-09-04T12:00:00Z");
const RESET = "\x1b[0m";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const OTHER_SESSION_ID = "2caaad43-674b-4bdb-88d7-3f18fce50aba";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const MODEL = "composer-2.5";

const WITH_DB = { DATABASE_URL: "postgres://user:pw@127.0.0.1:5432/oligarchy" };

type TestDefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;
type SessionRow = typeof DbSchema.sessions.$inferSelect;
type TestResultRow = typeof DbSchema.testResults.$inferSelect;

const install: TestDefinitionRow = {
  id: 1,
  name: "Install Omarchy",
  description: "Install the operating system",
  instruction: "Complete the installer",
  proof: "The desktop is visible",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const terminal: TestDefinitionRow = {
  id: 2,
  name: "Open a terminal",
  description: "Verify the terminal starts",
  instruction: "Launch the terminal",
  proof: "A terminal window is visible",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

// A second wording of install: same name, higher id, so it is the one a run pins from now on.
const installRevised: TestDefinitionRow = {
  ...install,
  id: 3,
  instruction: "Complete the installer, then log in",
  createdAt: new Date("2026-09-02T00:00:00Z"),
};

const jsonRow = (row: TestDefinitionRow, version: number) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  version,
});

const session = (id: string, status: SessionRow["status"], startedAt: Date): SessionRow => ({
  id,
  config: { iso: "omarchy.iso" },
  status,
  reason: null,
  startedAt,
  endedAt: null,
});

const result = (
  id: string,
  status: TestResultRow["status"],
  sessionId: string | null,
  definitionId = 1,
): TestResultRow => ({
  id,
  runId: RUN_ID,
  definitionId,
  sessionId,
  model: "grok-4.6",
  status,
  reason: null,
  createdAt: new Date("2026-09-03T00:00:00Z"),
  finishedAt: null,
});

const ago = (seconds: number): Date => new Date(NOW - seconds * 1000);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// ctrl reaches nothing over HTTP but Linear, faked here: a request to anything else dies.
const harness = (
  options: {
    readonly linear?: FakeLinear.FakeLinear;
    // Replaces the real FileSystem the prompt templates are read from.
    readonly fs?: Layer.Layer<FileSystem.FileSystem>;
  } = {},
) => {
  const stores = Stores.fakeStores();
  const log = FakeLog.fakeLog();
  const linear = options.linear ?? FakeLinear.fakeLinear();
  const touched: Array<string> = [];
  const command = CtrlCommand.makeCtrlCommand({
    database: () => {
      touched.push("database");
      return Layer.mergeAll(stores.layer, log.layer);
    },
    linear: () => {
      touched.push("linear");
      return linear.layer;
    },
  });
  // A later layer's service wins the merge, so the fake FileSystem replaces Node's.
  const services =
    options.fs === undefined ? NodeServices.layer : Layer.merge(NodeServices.layer, options.fs);
  const program = (args: ReadonlyArray<string>, env: Record<string, string>) =>
    Command.runWith(command, { version: Api.VERSION })(args).pipe(
      Effect.provide(Layer.mergeAll(services, Config.withEnv(env), FakeHttp.die)),
    );
  const run = (args: ReadonlyArray<string>, env: Record<string, string> = WITH_DB) =>
    Effect.exit(program(args, env));
  // The failure itself, for a command refused after parsing.
  const fail = (args: ReadonlyArray<string>, env: Record<string, string> = WITH_DB) =>
    Effect.flip(program(args, env));
  return { stores, log, linear, touched, run, fail };
};

const TEMPLATE = "Review Linear ticket {{LINEAR_TICKET}}\n";

// A FileSystem that serves one template for every prompt file except the ones matched, which
// fail as an unreadable file in the checkout would.
const promptFs = (
  unreadable: RegExp,
  template = TEMPLATE,
): { readonly reads: Array<string>; readonly layer: Layer.Layer<FileSystem.FileSystem> } => {
  const reads: Array<string> = [];
  const layer = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        reads.push(path);
        return unreadable.test(path)
          ? Effect.fail(FakeFs.permissionDenied("open", path))
          : Effect.succeed(template);
      }),
  });
  return { reads, layer };
};

const failure = (exit: Exit.Exit<void, unknown>): unknown => {
  if (Exit.isSuccess(exit)) {
    throw new Error("expected the command to fail");
  }
  return Cause.squash(exit.cause);
};

const helpErrors = (exit: Exit.Exit<void, unknown>): ReadonlyArray<string> => {
  const error = failure(exit);
  if (!CliError.isCliError(error) || error._tag !== "ShowHelp") {
    throw new Error(`expected ShowHelp, got ${String(error)}`);
  }
  return error.errors.map((entry) => entry.message);
};

const stdout = Effect.map(TestConsole.logLines, (lines) => lines.map(String));

const lastJson = Effect.map(stdout, (lines) => JSON.parse(lines.at(-1) ?? ""));

// The text a command hands an agent, rendered from the checkout's own templates and guides.
const rendered = (template: Prompts.Template, values: Prompts.Values) =>
  Prompts.render(template, values).pipe(Effect.provide(NodeFileSystem.layer));

// ---------------------------------------------------------------------------
// test --list
// ---------------------------------------------------------------------------

describe("test --list", () => {
  it.effect("prints one name per line (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(terminal, install);
      const exit = yield* h.run(["test", "--list"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["Install Omarchy", "Open a terminal"]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("prints nothing when there are no definitions (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["test", "--list"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect(
    "prints every field of one named definition as JSON with --details --name (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.tests.definitions.push(install, terminal);
        const exit = yield* h.run(["test", "--list", "--details", "--name", "Open a terminal"]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* lastJson).toEqual([
          { ...terminal, createdAt: terminal.createdAt.toISOString() },
        ]);
      }),
  );

  it.effect("rejects a name that matches no definition (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      const exit = yield* h.run(["test", "--list", "--name", "missing-definition"]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: "test: no test definition named missing-definition",
      });
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("rejects test without --list as a usage error (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["test"]);
      expect(helpErrors(exit).join("\n")).toMatch(/Missing required flag: --list/);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect(
    "prints each name once, and --details its newest wording, when one has several (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.tests.definitions.push(installRevised, terminal, install);
        const names = yield* h.run(["test", "--list"]);
        expect(Exit.isSuccess(names)).toBe(true);
        expect(yield* stdout).toEqual(["Install Omarchy", "Open a terminal"]);
        const details = yield* h.run(["test", "--list", "--details", "--name", "Install Omarchy"]);
        expect(Exit.isSuccess(details)).toBe(true);
        expect(yield* lastJson).toEqual([
          { ...installRevised, createdAt: installRevised.createdAt.toISOString() },
        ]);
      }),
  );

  it.effect(
    "--history prints every wording of every definition, oldest first, as name v<n> (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.tests.definitions.push(installRevised, terminal, install);
        const exit = yield* h.run(["test", "--list", "--history"]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* stdout).toEqual([
          "Install Omarchy v1",
          "Install Omarchy v2",
          "Open a terminal v1",
        ]);
        expect(h.touched).toEqual(["database"]);
      }),
  );

  it.effect(
    "--history --details --name prints one definition's wordings with their version as JSON (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.tests.definitions.push(installRevised, terminal, install);
        const exit = yield* h.run([
          "test",
          "--list",
          "--history",
          "--details",
          "--name",
          "Install Omarchy",
        ]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* lastJson).toEqual([jsonRow(install, 1), jsonRow(installRevised, 2)]);
      }),
  );

  it.effect(
    "--history prints nothing for no definitions, and rejects an unknown name (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const empty = yield* h.run(["test", "--list", "--history"]);
        expect(Exit.isSuccess(empty)).toBe(true);
        expect(yield* stdout).toEqual([]);
        h.stores.tests.definitions.push(install);
        const exit = yield* h.run(["test", "--list", "--history", "--name", "missing-definition"]);
        expect(failure(exit)).toMatchObject({
          _tag: "CommandError",
          message: "test: no test definition named missing-definition",
        });
        expect(yield* stdout).toEqual([]);
      }),
  );
});

// ---------------------------------------------------------------------------
// test define
// ---------------------------------------------------------------------------

const DEFINE = ["test", "define"];

describe("test define", () => {
  it.effect("defines a new test from all three fields and prints its id and version (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      const exit = yield* h.run([
        ...DEFINE,
        "--name",
        "Change lighting",
        "--description",
        "Verify the theme switches",
        "--instruction",
        "Toggle dark mode",
        "--proof",
        "The wallpaper is dark",
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      const [, defined] = h.stores.tests.definitions;
      expect(defined).toMatchObject({
        name: "Change lighting",
        description: "Verify the theme switches",
        instruction: "Toggle dark mode",
        proof: "The wallpaper is dark",
      });
      expect(defined?.id).toBeGreaterThan(install.id);
      expect(yield* lastJson).toEqual({ id: defined?.id, name: "Change lighting", version: 1 });
      expect(h.log.lines.map((line) => line.text)).toEqual([
        `test definition defined; Change lighting v1; id ${String(defined?.id)}`,
      ]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("revises a known test from one flag, carrying the other fields forward (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install, terminal);
      const exit = yield* h.run([
        ...DEFINE,
        "--name",
        "Install Omarchy",
        "--proof",
        "The desktop shows the dock",
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.definitions).toHaveLength(3);
      expect(h.stores.tests.definitions[0]).toEqual(install);
      const revised = h.stores.tests.definitions[2];
      expect(revised).toMatchObject({
        name: "Install Omarchy",
        description: install.description,
        instruction: install.instruction,
        proof: "The desktop shows the dock",
      });
      expect(revised?.id).toBeGreaterThan(terminal.id);
      expect(yield* lastJson).toEqual({ id: revised?.id, name: "Install Omarchy", version: 2 });
      expect(h.log.lines.map((line) => line.text)).toEqual([
        `test definition defined; Install Omarchy v2; id ${String(revised?.id)}`,
      ]);
    }),
  );

  it.effect(
    "refuses a new name that is missing a field, before anything is written (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const exit = yield* h.run([...DEFINE, "--name", "Change lighting", "--proof", "p"]);
        expect(failure(exit)).toMatchObject({
          _tag: "CommandError",
          message: "test define: a new definition needs --description, --instruction and --proof",
        });
        expect(h.stores.tests.definitions).toEqual([]);
        expect(h.log.lines).toEqual([]);
        expect(yield* stdout).toEqual([]);
      }),
  );

  it.effect("refuses a revision that changes nothing (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      const same = yield* h.run([...DEFINE, "--name", "Install Omarchy", "--proof", install.proof]);
      expect(failure(same)).toMatchObject({
        _tag: "CommandError",
        message: "test define: Install Omarchy is unchanged",
      });
      const nothing = yield* h.run([...DEFINE, "--name", "Install Omarchy"]);
      expect(failure(nothing)).toMatchObject({
        message: "test define: Install Omarchy is unchanged",
      });
      expect(h.stores.tests.definitions).toEqual([install]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("requires --name, and DATABASE_URL after parsing (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const unnamed = yield* h.run([...DEFINE, "--description", "d"]);
      expect(helpErrors(unnamed).join("\n")).toMatch(/Missing required flag: --name/);
      const empty = yield* h.run([...DEFINE, "--name", ""]);
      expect(helpErrors(empty).join("\n")).toMatch(/--name.*length of at least 1/s);
      expect(h.touched).toEqual([]);
      const unset = yield* h.run([...DEFINE, "--name", "Change lighting"], {});
      expect(failure(unset)).toMatchObject({
        _tag: "MissingVariable",
        message: "DATABASE_URL is not set",
      });
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// test new
// ---------------------------------------------------------------------------

const NEW = ["test", "new", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"];
const WITH_LINEAR = { ...WITH_DB, LINEAR_API_TOKEN: "linear-token" };

describe("test new", () => {
  it.effect(
    "creates the run and pending results, then one described Linear ticket per definition (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.tests.definitions.push(terminal, install);
        const exit = yield* h.run([...NEW, `--server-url=${SERVER}`], WITH_LINEAR);
        expect(Exit.isSuccess(exit)).toBe(true);

        const [run] = h.stores.tests.runs;
        expect(run).toMatchObject({
          name: "Omarchy experiment",
          iso: "https://example.com/omarchy.iso",
          serverUrl: SERVER,
          status: "pending",
          reason: null,
        });
        expect(run).not.toHaveProperty("model");
        const results = h.stores.tests.results;
        expect(results.map((row) => [row.runId, row.definitionId, row.status, row.model])).toEqual([
          [run?.id, 1, "pending", null],
          [run?.id, 2, "pending", null],
        ]);

        // Each ticket is the one template filled with that definition's values and its own ids.
        const descriptionOf = (definition: TestDefinitionRow, index: number, identifier: string) =>
          rendered("linear-issue.html", {
            LINEAR_TICKET: identifier,
            RUN_ID: run?.id ?? "",
            RESULT_ID: results[index]?.id ?? "",
            VERSION: "1.2.3",
            ISO_URL: "https://example.com/omarchy.iso",
            SERVER_URL: SERVER,
            TEST_NAME: definition.name,
            TEST_DESCRIPTION: definition.description,
            TEST_INSTRUCTION: definition.instruction,
            TEST_PROOF: definition.proof,
          });
        const installDescription = yield* descriptionOf(install, 0, "OLI-42");
        const terminalDescription = yield* descriptionOf(terminal, 1, "OLI-43");
        const labels = [FakeLinear.labelId("agent test"), FakeLinear.labelId("1.2.3")];
        expect(h.linear.calls).toEqual([
          { method: "teamId" },
          { method: "labelIds", teamId: "team-id", version: "1.2.3" },
          { method: "assigneeId" },
          {
            method: "createIssue",
            input: {
              teamId: "team-id",
              title: "Omarchy: Install Omarchy",
              labelIds: labels,
              assigneeId: "user-id",
            },
          },
          {
            method: "describeIssue",
            ticket: FakeLinear.ticketFor("OLI-42"),
            description: installDescription,
          },
          {
            method: "createIssue",
            input: {
              teamId: "team-id",
              title: "Omarchy: Open a terminal",
              labelIds: labels,
              assigneeId: "user-id",
            },
          },
          {
            method: "describeIssue",
            ticket: FakeLinear.ticketFor("OLI-43"),
            description: terminalDescription,
          },
        ]);

        expect(yield* lastJson).toEqual({
          id: run?.id,
          tests: [
            { id: results[0]?.id, linear: FakeLinear.ticketFor("OLI-42") },
            { id: results[1]?.id, linear: FakeLinear.ticketFor("OLI-43") },
          ],
        });
        expect(h.log.lines).toEqual([
          {
            level: "info",
            text: `test ${run?.id} created; 2 tests; OLI-42, OLI-43`,
            sessionId: undefined,
            agentId: undefined,
            skipSentry: false,
            cause: undefined,
          },
        ]);
        expect(h.touched).toEqual(["database", "linear"]);
      }),
  );

  it.effect("creates one result and one ticket for a named definition (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install, terminal);
      const exit = yield* h.run(
        [...NEW, "--server-url", SERVER, "--name", "Install Omarchy"],
        WITH_LINEAR,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results.map((row) => row.definitionId)).toEqual([1]);
      expect(h.linear.calls.filter((call) => call.method === "createIssue")).toHaveLength(1);
      expect(h.log.lines.map((line) => line.text)).toEqual([
        `test ${h.stores.tests.runs[0]?.id} created; 1 tests; OLI-42`,
      ]);
    }),
  );

  it.effect("pins the newest wording of a definition that has several, and its text (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install, installRevised, terminal);
      const exit = yield* h.run([...NEW, "--server-url", SERVER], WITH_LINEAR);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results.map((row) => row.definitionId)).toEqual([
        installRevised.id,
        terminal.id,
      ]);
      const described = h.linear.calls.find((call) => call.method === "describeIssue");
      expect(described?.method === "describeIssue" ? described.description : "").toContain(
        installRevised.instruction,
      );
    }),
  );

  it.effect("--name runs the newest wording of that definition, never an older one (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      // The older wording is listed last, so the newest wins by id, not by position.
      h.stores.tests.definitions.push(installRevised, terminal, install);
      const exit = yield* h.run(
        [...NEW, "--server-url", SERVER, "--name", "Install Omarchy"],
        WITH_LINEAR,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results.map((row) => row.definitionId)).toEqual([installRevised.id]);
      const described = h.linear.calls.filter((call) => call.method === "describeIssue");
      expect(described).toHaveLength(1);
      const description = described[0]?.method === "describeIssue" ? described[0].description : "";
      expect(description).toContain(installRevised.instruction);
      expect(description).not.toContain(`<instruction>${install.instruction}</instruction>`);
      expect(h.log.lines.map((line) => line.text)).toEqual([
        `test ${h.stores.tests.runs[0]?.id} created; 1 tests; OLI-42`,
      ]);
    }),
  );

  it.effect("rejects an experiment with no test definitions before touching Linear (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run([...NEW, "--server-url", SERVER], WITH_LINEAR);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: "test: no test definitions found",
      });
      expect(h.stores.tests.runs).toEqual([]);
      expect(h.linear.calls).toEqual([]);
    }),
  );

  it.effect("rejects a name that matches no test definition (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      const exit = yield* h.run(
        [...NEW, "--server-url", SERVER, "--name", "Change lighting"],
        WITH_LINEAR,
      );
      expect(failure(exit)).toMatchObject({
        message: "test: no test definition named Change lighting",
      });
      expect(h.stores.tests.runs).toEqual([]);
      expect(h.linear.calls).toEqual([]);
    }),
  );

  it.effect("marks the run and results failed when Linear refuses the token (unhappy)", () =>
    Effect.gen(function* () {
      const refused = Errors.LinearError.make({
        operation: "teamId",
        status: 401,
        message: "linear: request failed (401): unauthorized",
      });
      const h = harness({
        linear: FakeLinear.fakeLinear({ overrides: { teamId: Effect.fail(refused) } }),
      });
      h.stores.tests.definitions.push(install);
      const exit = yield* h.run([...NEW, "--server-url", SERVER], WITH_LINEAR);
      expect(failure(exit)).toMatchObject({
        _tag: "LinearError",
        message: "linear: request failed (401): unauthorized",
      });
      expect(h.stores.tests.runs[0]).toMatchObject({
        status: "failed",
        reason: "linear: request failed (401): unauthorized",
      });
      expect(h.stores.tests.runs[0]?.endedAt).toBeInstanceOf(Date);
      expect(h.stores.tests.results[0]).toMatchObject({
        status: "failed",
        reason: "linear: request failed (401): unauthorized",
      });
      expect(h.stores.tests.results[0]?.finishedAt).toBeInstanceOf(Date);
      expect(h.log.lines).toEqual([]);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("names every ticket created, including one whose description failed (unhappy)", () =>
    Effect.gen(function* () {
      const refused = Errors.LinearError.make({
        operation: "describeIssue",
        status: 401,
        message: "linear: request failed (401): unauthorized",
      });
      const h = harness({
        linear: FakeLinear.fakeLinear({
          overrides: {
            describeIssue: (ticket) =>
              ticket.id === "issue-OLI-43" ? Effect.fail(refused) : Effect.void,
          },
        }),
      });
      h.stores.tests.definitions.push(install, terminal);
      const exit = yield* h.run([...NEW, "--server-url", SERVER], WITH_LINEAR);
      expect(failure(exit)).toMatchObject({
        _tag: "LinearError",
        message: "linear: request failed (401): unauthorized; created OLI-42, OLI-43",
      });
      expect(h.stores.tests.runs[0]?.reason).toBe(
        "linear: request failed (401): unauthorized; created OLI-42, OLI-43",
      );
      expect(h.stores.tests.results.map((row) => row.status)).toEqual(["failed", "failed"]);
    }),
  );

  it.effect(
    "fails the run naming the ticket created when a guide its description embeds is unreadable (unhappy)",
    () =>
      Effect.gen(function* () {
        // The guide is read while describing the first ticket, so that ticket already exists.
        const fs = promptFs(/\/client\.md$/, "{{LINEAR_TICKET}} {{CLIENT_MD}}");
        const h = harness({ fs: fs.layer });
        h.stores.tests.definitions.push(install, terminal);
        const exit = yield* h.run([...NEW, "--server-url", SERVER], WITH_LINEAR);
        const error = failure(exit);
        expect(error).toMatchObject({
          _tag: "PromptError",
          message: expect.stringMatching(/^prompt: .*client\.md.*; created OLI-42$/),
          cause: expect.anything(),
        });
        expect(h.linear.calls.map((call) => call.method)).toEqual([
          "teamId",
          "labelIds",
          "assigneeId",
          "createIssue",
        ]);
        expect(h.stores.tests.runs[0]).toMatchObject({
          status: "failed",
          reason: expect.stringMatching(/^prompt: .*client\.md.*; created OLI-42$/),
        });
        expect(h.stores.tests.results.map((row) => row.status)).toEqual(["failed", "failed"]);
      }),
  );

  it.effect(
    "names the ticket created when its description cannot be rendered, and describes nothing (unhappy)",
    () =>
      Effect.gen(function* () {
        // The ticket template asks for a value no run carries; the guides render fine.
        const fs = promptFs(/never/, "{{RUN_ID}} {{NOPE}}");
        const h = harness({ fs: fs.layer });
        h.stores.tests.definitions.push(install);
        const exit = yield* h.run([...NEW, "--server-url", SERVER], WITH_LINEAR);
        const message =
          "prompt: prompts/linear-issue.html uses {{NOPE}}, which has no value; created OLI-42";
        expect(failure(exit)).toMatchObject({ _tag: "PromptError", message });
        expect(h.linear.calls.map((call) => call.method)).toEqual([
          "teamId",
          "labelIds",
          "assigneeId",
          "createIssue",
        ]);
        expect(h.stores.tests.runs[0]).toMatchObject({ status: "failed", reason: message });
        expect(h.stores.tests.results.map((row) => row.status)).toEqual(["failed"]);
        expect(yield* stdout).toEqual([]);
      }),
  );

  it.effect("rejects an ISO that is not HTTPS or has no host (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const http = yield* h.run(
        [
          "test",
          "new",
          "--iso",
          "http://example.com/omarchy.iso",
          `--server-url=${SERVER}`,
          "--version",
          "1.2.3",
        ],
        WITH_LINEAR,
      );
      expect(helpErrors(http).join("\n")).toMatch(/iso must be a valid https url/);
      const hostless = yield* h.run(
        ["test", "new", "--iso", "https://?", `--server-url=${SERVER}`, "--version", "1.2.3"],
        WITH_LINEAR,
      );
      expect(helpErrors(hostless).join("\n")).toMatch(/iso must be a valid https url/);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("rejects a missing ISO, a missing version and the old underscore flag (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const missingIso = yield* h.run(
        ["test", "new", `--server-url=${SERVER}`, "--version", "1.2.3"],
        WITH_LINEAR,
      );
      expect(helpErrors(missingIso).join("\n")).toMatch(/Missing required flag: --iso/);
      const missingVersion = yield* h.run(
        ["test", "new", "--iso", "https://example.com/omarchy.iso", `--server-url=${SERVER}`],
        WITH_LINEAR,
      );
      expect(helpErrors(missingVersion).join("\n")).toMatch(/Missing required flag: --version/);
      const underscore = yield* h.run(
        [
          "test",
          "new",
          "--iso",
          "https://example.com/omarchy.iso",
          `--server_url=${SERVER}`,
          "--version",
          "1.2.3",
        ],
        WITH_LINEAR,
      );
      expect(helpErrors(underscore).join("\n")).toMatch(/Unrecognized flag: --server_url/);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// test list
// ---------------------------------------------------------------------------

describe("test list", () => {
  it.effect("prints the backlog as a JSON array (happy)", () =>
    Effect.gen(function* () {
      const backlog = [
        { id: "i1", identifier: "OLI-1", title: "one", url: "https://linear.app/issue/OLI-1" },
        { id: "i2", identifier: "OLI-2", title: "two", url: "https://linear.app/issue/OLI-2" },
      ];
      const h = harness({ linear: FakeLinear.fakeLinear({ backlog }) });
      const exit = yield* h.run(["test", "list"], WITH_LINEAR);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toEqual(backlog);
      expect(h.linear.calls).toEqual([{ method: "listBacklog" }]);
      expect(h.touched).toEqual(["database", "linear"]);
    }),
  );

  it.effect("prints [] for an empty backlog (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["test", "list"], WITH_LINEAR);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["[]"]);
    }),
  );

  it.effect("surfaces a Linear failure as its message (unhappy)", () =>
    Effect.gen(function* () {
      const refused = Errors.LinearError.make({
        operation: "listBacklog",
        message: "linear: invalid response",
      });
      const h = harness({
        linear: FakeLinear.fakeLinear({ overrides: { listBacklog: Effect.fail(refused) } }),
      });
      const exit = yield* h.run(["test", "list"], WITH_LINEAR);
      expect(failure(exit)).toBe(refused);
      expect(yield* stdout).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// gone Cursor agent kickoffs
// ---------------------------------------------------------------------------

describe("test run and diagnose run", () => {
  it.effect("are unknown actions: they spawn no agent and touch nothing (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      for (const args of [
        ["test", "run", "--ticket", "OLI-42"],
        ["diagnose", "run", "--session-id", SESSION_ID],
      ]) {
        const exit = yield* h.run(args, {});
        expect(helpErrors(exit).length, args.join(" ")).toBeGreaterThan(0);
      }
      expect(h.touched).toEqual([]);
      expect(yield* stdout).not.toContain(expect.stringContaining("Agent here"));
    }),
  );
});

// ---------------------------------------------------------------------------
// test start
// ---------------------------------------------------------------------------

describe("test start", () => {
  it.effect("records the session and model on a pending result and marks it running (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "running", ago(10)));
      h.stores.tests.results.push(result(RESULT_ID, "pending", null));
      const exit = yield* h.run([
        "test",
        "start",
        "--session-id",
        SESSION_ID,
        "--test-result-id",
        RESULT_ID,
        "--model",
        MODEL,
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results[0]).toMatchObject({
        status: "running",
        sessionId: SESSION_ID,
        model: MODEL,
      });
      // The line belongs to the session alone: no agent, so no palette colour is taken.
      expect(h.log.lines).toEqual([
        {
          level: "info",
          text: `test result ${RESULT_ID}: running`,
          sessionId: SESSION_ID,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(h.log.acquired).toEqual([]);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("rejects an unknown session before touching the result (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(result(RESULT_ID, "pending", null));
      const exit = yield* h.run([
        "test",
        "start",
        "--session-id",
        SESSION_ID,
        "--test-result-id",
        RESULT_ID,
        "--model",
        MODEL,
      ]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: `test start: no session ${SESSION_ID}`,
      });
      expect(h.stores.tests.results[0]?.status).toBe("pending");
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("rejects a result that is missing or not pending (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "running", ago(10)));
      h.stores.tests.results.push(result(RESULT_ID, "running", OTHER_SESSION_ID));
      const notPending = yield* h.run([
        "test",
        "start",
        "--session-id",
        SESSION_ID,
        "--test-result-id",
        RESULT_ID,
        "--model",
        MODEL,
      ]);
      expect(failure(notPending)).toMatchObject({
        message: `test start: result ${RESULT_ID} not found or not pending`,
      });
      const missing = yield* h.run([
        "test",
        "start",
        "--session-id",
        SESSION_ID,
        "--test-result-id",
        OTHER_RESULT_ID,
        "--model",
        MODEL,
      ]);
      expect(failure(missing)).toMatchObject({
        message: `test start: result ${OTHER_RESULT_ID} not found or not pending`,
      });
      expect(h.stores.tests.results[0]?.sessionId).toBe(OTHER_SESSION_ID);
    }),
  );

  it.effect("rejects a missing or empty model (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "running", ago(10)));
      h.stores.tests.results.push(result(RESULT_ID, "pending", null));
      const missing = yield* h.run([
        "test",
        "start",
        "--session-id",
        SESSION_ID,
        "--test-result-id",
        RESULT_ID,
      ]);
      expect(helpErrors(missing).join("\n")).toMatch(/Missing required flag: --model/);
      const empty = yield* h.run([
        "test",
        "start",
        "--session-id",
        SESSION_ID,
        "--test-result-id",
        RESULT_ID,
        "--model",
        "",
      ]);
      expect(helpErrors(empty).join("\n")).toMatch(/--model.*length of at least 1/s);
      expect(h.stores.tests.results[0]).toMatchObject({ status: "pending", model: "grok-4.6" });
    }),
  );

  it.effect("rejects the old underscore flags (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run([
        "test",
        "start",
        "--session_id",
        SESSION_ID,
        "--test_result_id",
        RESULT_ID,
      ]);
      expect(helpErrors(exit).join("\n")).toMatch(/Unrecognized flag: --session_id/);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// test-results
// ---------------------------------------------------------------------------

describe("test-results", () => {
  it.effect("maps success to passed, records the agent's session and logs it (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.agentRuns.push({
        agentId: "agent-1",
        sessionId: SESSION_ID,
        startedAt: ago(100),
        endedAt: null,
      });
      h.stores.tests.results.push(result(RESULT_ID, "running", null));
      const exit = yield* h.run([
        "test-results",
        "--agent-id",
        "agent-1",
        "--id",
        RESULT_ID,
        "--status",
        "success",
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results[0]).toMatchObject({
        status: "passed",
        sessionId: SESSION_ID,
        reason: null,
      });
      expect(h.stores.tests.results[0]?.finishedAt).toBeInstanceOf(Date);
      expect(h.log.lines).toEqual([
        {
          level: "info",
          text: `test result ${RESULT_ID}: passed`,
          sessionId: SESSION_ID,
          agentId: "agent-1",
          skipSentry: false,
          cause: undefined,
        },
      ]);
      // v1 took the agent's palette colour before its line, so the line renders in colour.
      expect(h.log.acquired).toEqual(["agent-1"]);
    }),
  );

  it.effect("without --reason leaves the reason an earlier verdict stored (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push({
        ...result(RESULT_ID, "passed", SESSION_ID),
        reason: "it locked",
      });
      const exit = yield* h.run([
        "test-results",
        "--agent-id",
        "agent-1",
        "--id",
        RESULT_ID,
        "--status",
        "failed",
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results[0]).toMatchObject({
        status: "failed",
        sessionId: SESSION_ID,
        reason: "it locked",
      });
      expect(h.log.lines.map((line) => line.text)).toEqual([`test result ${RESULT_ID}: failed`]);
    }),
  );

  it.effect(
    "stores failed with its reason and leaves the session when the agent has none (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.tests.results.push(result(RESULT_ID, "running", SESSION_ID));
        const exit = yield* h.run([
          "test-results",
          "--agent-id",
          "agent-1",
          "--id",
          RESULT_ID,
          "--status",
          "failed",
          "--reason",
          "installer hung",
        ]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(h.stores.tests.results[0]).toMatchObject({
          status: "failed",
          sessionId: SESSION_ID,
          reason: "installer hung",
        });
        expect(h.log.lines.map((line) => [line.text, line.sessionId, line.agentId])).toEqual([
          [`test result ${RESULT_ID}: failed; installer hung`, undefined, "agent-1"],
        ]);
        expect(h.log.acquired).toEqual(["agent-1"]);
      }),
  );

  it.effect("rejects an unknown result and takes no colour for it (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run([
        "test-results",
        "--agent-id",
        "agent-1",
        "--id",
        RESULT_ID,
        "--status",
        "failed",
        "--reason",
        "installer hung",
      ]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: `test-results: result ${RESULT_ID} not found`,
      });
      expect(h.log.lines).toEqual([]);
      expect(h.log.acquired).toEqual([]);
    }),
  );

  it.effect("requires --agent-id and a known status (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const noAgent = yield* h.run(["test-results", "--id", RESULT_ID, "--status", "success"]);
      expect(helpErrors(noAgent).join("\n")).toMatch(/Missing required flag: --agent-id/);
      const badStatus = yield* h.run([
        "test-results",
        "--agent-id",
        "a",
        "--id",
        RESULT_ID,
        "--status",
        "passed",
      ]);
      expect(helpErrors(badStatus).join("\n")).toMatch(/--status/);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// session list
// ---------------------------------------------------------------------------

describe("session list", () => {
  it.effect("prints coloured status, age and id lines, newest first (happy)", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "succeeded", ago(90)),
        session(OTHER_SESSION_ID, "running", ago(5)),
      );
      const exit = yield* h.run(["session", "list"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual([
        `\x1b[33mrunning    ${RESET}  5s ago       ${OTHER_SESSION_ID}`,
        `\x1b[32msucceeded  ${RESET}  1m ago       ${SESSION_ID}`,
      ]);
    }),
  );

  it.effect("--count bounds the listing and --count=1 parses (happy)", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "succeeded", ago(90)),
        session(OTHER_SESSION_ID, "running", ago(5)),
      );
      const exit = yield* h.run(["session", "list", "--count=1"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual([
        `\x1b[33mrunning    ${RESET}  5s ago       ${OTHER_SESSION_ID}`,
      ]);
    }),
  );

  it.effect("--active --json returns only active sessions with running rows first (happy)", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "downloading", ago(5)),
        session(OTHER_SESSION_ID, "running", ago(90)),
        session("3daaad43-674b-4bdb-88d7-3f18fce50aba", "failed", ago(1)),
      );
      const exit = yield* h.run(["session", "list", "--active", "--json", "--count", "10"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toEqual([
        { id: OTHER_SESSION_ID, status: "running", startedAt: ago(90).toISOString() },
        { id: SESSION_ID, status: "downloading", startedAt: ago(5).toISOString() },
      ]);
    }),
  );

  it.effect("prints [] as JSON and nothing as text when there are no sessions (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      expect(Exit.isSuccess(yield* h.run(["session", "list", "--json"]))).toBe(true);
      expect(Exit.isSuccess(yield* h.run(["session", "list"]))).toBe(true);
      expect(yield* stdout).toEqual(["[]"]);
    }),
  );

  it.effect("rejects a count below one, a non-integer count, and the inspect flags (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const zero = yield* h.run(["session", "list", "--count", "0"]);
      expect(helpErrors(zero).join("\n")).toMatch(
        /Invalid value for flag --count: "0".*count must be at least 1/s,
      );
      const word = yield* h.run(["session", "list", "--count", "ten"]);
      expect(helpErrors(word).join("\n")).toMatch(/Invalid value for flag --count: "ten"/);
      const inspectFlag = yield* h.run(["session", "list", "--session-id", SESSION_ID]);
      expect(helpErrors(inspectFlag).join("\n")).toMatch(/Unrecognized flag: --session-id/);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// error-type new / list
// ---------------------------------------------------------------------------

type ErrorTypeRow = typeof DbSchema.postRunErrorTypes.$inferSelect;
type DiagnosisRow = typeof DbSchema.postRunDiagnosis.$inferSelect;

const bootHang: ErrorTypeRow = {
  key: "guest_boot_hang",
  description: "The guest never reached the login screen",
  createdAt: new Date("2026-09-02T00:00:00Z"),
};

const misread: ErrorTypeRow = {
  key: "agent_misread_screen",
  description: "The agent acted on a screen it described wrongly",
  createdAt: new Date("2026-09-02T00:00:01Z"),
};

const diagnosis: DiagnosisRow = {
  sessionId: SESSION_ID,
  verdict: "failed",
  errorType: bootHang.key,
  summary: "Serial shows the kernel waiting on the root device; the ISO never mounted",
  model: MODEL,
  createdAt: new Date("2026-09-03T00:00:05Z"),
};

// A pass names no cause: the reviewer saw the proof on screen.
const passed: DiagnosisRow = {
  sessionId: SESSION_ID,
  verdict: "passed",
  errorType: null,
  summary: "The last image shows the lock screen with the clock; matches the proof",
  model: MODEL,
  createdAt: new Date("2026-09-03T00:00:05Z"),
};

const NEW_TYPE = [
  "error-type",
  "new",
  "--key",
  bootHang.key,
  "--description",
  bootHang.description,
];

describe("error-type new", () => {
  it.effect("stores the key and description and logs the creation (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(NEW_TYPE);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.diagnosis.errorTypes).toHaveLength(1);
      expect(h.stores.diagnosis.errorTypes[0]).toMatchObject({
        key: bootHang.key,
        description: bootHang.description,
      });
      expect(h.stores.diagnosis.errorTypes[0]?.createdAt).toBeInstanceOf(Date);
      expect(h.log.lines).toEqual([
        {
          level: "info",
          text: `error type created; ${bootHang.key}`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(yield* stdout).toEqual([]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("refuses a key that already exists and leaves the stored description (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.diagnosis.errorTypes.push(bootHang);
      const error = yield* h.fail([
        "error-type",
        "new",
        "--key",
        bootHang.key,
        "--description",
        "a second meaning",
      ]);
      expect(error).toMatchObject({
        _tag: "CommandError",
        message: `error-type new: ${bootHang.key} already exists`,
      });
      expect(h.stores.diagnosis.errorTypes).toEqual([bootHang]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("refuses a key that is not snake_case before touching the database (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      for (const key of ["Guest Boot Hang", "guest-boot-hang", "7_days", ""]) {
        const exit = yield* h.run(["error-type", "new", "--key", key, "--description", "d"]);
        expect(helpErrors(exit).join("\n"), key).toMatch(
          /key must be snake_case: a-z, 0-9 and _, starting with a letter/,
        );
      }
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("requires --key and a non-empty --description (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const noKey = yield* h.run(["error-type", "new", "--description", "d"]);
      expect(helpErrors(noKey).join("\n")).toMatch(/Missing required flag: --key/);
      const noDescription = yield* h.run(["error-type", "new", "--key", bootHang.key]);
      expect(helpErrors(noDescription).join("\n")).toMatch(/Missing required flag: --description/);
      const empty = yield* h.run(["error-type", "new", "--key", bootHang.key, "--description", ""]);
      expect(helpErrors(empty).join("\n")).toMatch(/--description.*length of at least 1/s);
      expect(h.touched).toEqual([]);
    }),
  );
});

describe("error-type list", () => {
  it.effect("prints key and description columns ordered by key (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.diagnosis.errorTypes.push(bootHang, misread);
      const exit = yield* h.run(["error-type", "list"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual([
        `agent_misread_screen  ${misread.description}`,
        `guest_boot_hang       ${bootHang.description}`,
      ]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("--json prints the rows as a JSON array (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.diagnosis.errorTypes.push(bootHang);
      const exit = yield* h.run(["error-type", "list", "--json"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toEqual([
        { ...bootHang, createdAt: bootHang.createdAt.toISOString() },
      ]);
    }),
  );

  it.effect("prints nothing as text and [] as JSON when there are no types (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      expect(Exit.isSuccess(yield* h.run(["error-type", "list"]))).toBe(true);
      expect(Exit.isSuccess(yield* h.run(["error-type", "list", "--json"]))).toBe(true);
      expect(yield* stdout).toEqual(["[]"]);
    }),
  );

  it.effect("bare error-type prints help and touches nothing (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["error-type"], {});
      expect(helpErrors(exit)).toEqual([]);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// diagnose
// ---------------------------------------------------------------------------

const DIAGNOSE = [
  "diagnose",
  "--session-id",
  SESSION_ID,
  "--verdict",
  "failed",
  "--type",
  bootHang.key,
  "--summary",
  diagnosis.summary,
  "--model",
  MODEL,
];

const DIAGNOSE_PASSED = [
  "diagnose",
  "--session-id",
  SESSION_ID,
  "--verdict",
  "passed",
  "--summary",
  passed.summary,
  "--model",
  MODEL,
];

const diagnoseLine = (text: string) => ({
  level: "info",
  text,
  sessionId: SESSION_ID,
  agentId: undefined,
  skipSentry: false,
  cause: undefined,
});

describe("diagnose", () => {
  it.effect("writes a failed verdict with its cause for a failed session and logs it (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      h.stores.diagnosis.errorTypes.push(bootHang);
      const exit = yield* h.run(DIAGNOSE);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.diagnosis.diagnoses).toHaveLength(1);
      expect(h.stores.diagnosis.diagnoses[0]).toMatchObject({
        sessionId: SESSION_ID,
        verdict: "failed",
        errorType: bootHang.key,
        summary: diagnosis.summary,
        model: MODEL,
      });
      expect(h.stores.diagnosis.diagnoses[0]?.createdAt).toBeInstanceOf(Date);
      expect(h.log.lines).toEqual([diagnoseLine(`diagnosed; failed; ${bootHang.key}; ${MODEL}`)]);
      expect(h.log.acquired).toEqual([]);
      expect(yield* stdout).toEqual([]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("writes a passed verdict, with no cause, for a succeeded session (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "succeeded", ago(500)));
      const exit = yield* h.run(DIAGNOSE_PASSED);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.diagnosis.diagnoses).toEqual([
        {
          sessionId: SESSION_ID,
          verdict: "passed",
          errorType: null,
          summary: passed.summary,
          model: MODEL,
          createdAt: expect.any(Date),
        },
      ]);
      expect(h.log.lines).toEqual([diagnoseLine(`diagnosed; passed; ${MODEL}`)]);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("the verdict is the reviewer's, not the driver's: it may disagree (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "succeeded", ago(500)),
        session(OTHER_SESSION_ID, "failed", ago(400)),
      );
      h.stores.diagnosis.errorTypes.push(misread);
      // The driver claimed success; the images say otherwise.
      expect(
        Exit.isSuccess(
          yield* h.run([
            "diagnose",
            "--session-id",
            SESSION_ID,
            "--verdict",
            "failed",
            "--type",
            misread.key,
            "--summary",
            "the final image is the installer, not the desktop",
            "--model",
            MODEL,
          ]),
        ),
      ).toBe(true);
      // The driver gave up; the proof was on screen all along.
      expect(
        Exit.isSuccess(
          yield* h.run([
            "diagnose",
            "--session-id",
            OTHER_SESSION_ID,
            "--verdict",
            "passed",
            "--summary",
            "the last image shows the desktop the proof asks for",
            "--model",
            MODEL,
          ]),
        ),
      ).toBe(true);
      expect(
        h.stores.diagnosis.diagnoses.map((row) => [row.sessionId, row.verdict, row.errorType]),
      ).toEqual([
        [SESSION_ID, "failed", misread.key],
        [OTHER_SESSION_ID, "passed", null],
      ]);
    }),
  );

  it.effect("accepts aborted and timed_out sessions: every session that has ended (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "aborted", ago(500)),
        session(OTHER_SESSION_ID, "timed_out", ago(400)),
      );
      h.stores.diagnosis.errorTypes.push(bootHang);
      expect(Exit.isSuccess(yield* h.run(DIAGNOSE))).toBe(true);
      expect(
        Exit.isSuccess(
          yield* h.run([
            "diagnose",
            "--session-id",
            OTHER_SESSION_ID,
            "--verdict",
            "failed",
            "--type",
            bootHang.key,
            "--summary",
            "the sweep closed it",
            "--model",
            MODEL,
          ]),
        ),
      ).toBe(true);
      expect(h.stores.diagnosis.diagnoses.map((row) => row.sessionId)).toEqual([
        SESSION_ID,
        OTHER_SESSION_ID,
      ]);
    }),
  );

  it.effect("rejects an unknown session before touching the types (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.diagnosis.errorTypes.push(bootHang);
      expect(yield* h.fail(DIAGNOSE)).toMatchObject({
        _tag: "CommandError",
        message: `diagnose: no session ${SESSION_ID}`,
      });
      expect(h.stores.diagnosis.diagnoses).toEqual([]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("rejects a session that is still running or downloading (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "running", ago(5)),
        session(OTHER_SESSION_ID, "downloading", ago(5)),
      );
      h.stores.diagnosis.errorTypes.push(bootHang);
      expect(yield* h.fail(DIAGNOSE)).toMatchObject({
        _tag: "CommandError",
        message: `diagnose: session ${SESSION_ID} is still running`,
      });
      const downloading = yield* h.fail([
        "diagnose",
        "--session-id",
        OTHER_SESSION_ID,
        "--verdict",
        "passed",
        "--summary",
        "s",
        "--model",
        MODEL,
      ]);
      expect(downloading).toMatchObject({
        _tag: "CommandError",
        message: `diagnose: session ${OTHER_SESSION_ID} is still downloading`,
      });
      expect(h.stores.diagnosis.diagnoses).toEqual([]);
    }),
  );

  it.effect("a failed verdict needs a type and a passed one takes none (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      h.stores.diagnosis.errorTypes.push(bootHang);
      const untyped = yield* h.fail([
        "diagnose",
        "--session-id",
        SESSION_ID,
        "--verdict",
        "failed",
        "--summary",
        "s",
        "--model",
        MODEL,
      ]);
      expect(untyped).toMatchObject({
        _tag: "CommandError",
        message: "diagnose: --verdict failed needs --type",
      });
      const typed = yield* h.fail([...DIAGNOSE_PASSED, "--type", bootHang.key]);
      expect(typed).toMatchObject({
        _tag: "CommandError",
        message: "diagnose: --verdict passed takes no --type",
      });
      expect(h.stores.diagnosis.diagnoses).toEqual([]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("rejects an error type that does not exist and names the fix (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      expect(yield* h.fail(DIAGNOSE)).toMatchObject({
        _tag: "CommandError",
        message: `diagnose: no error type ${bootHang.key}; create it with ./ctrl error-type new`,
      });
      expect(h.stores.diagnosis.diagnoses).toEqual([]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("rejects a second diagnosis for the same session and keeps the first (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      h.stores.diagnosis.errorTypes.push(bootHang, misread);
      expect(Exit.isSuccess(yield* h.run(DIAGNOSE))).toBe(true);
      const second = yield* h.fail(DIAGNOSE_PASSED);
      expect(second).toMatchObject({
        _tag: "CommandError",
        message: `diagnose: session ${SESSION_ID} already has a diagnosis`,
      });
      expect(h.stores.diagnosis.diagnoses).toHaveLength(1);
      expect(h.stores.diagnosis.diagnoses[0]).toMatchObject({
        verdict: "failed",
        errorType: bootHang.key,
      });
      expect(h.log.lines.map((line) => line.text)).toEqual([
        `diagnosed; failed; ${bootHang.key}; ${MODEL}`,
      ]);
    }),
  );

  it.effect(
    "refuses a missing or unknown --verdict, a bad --type, and a missing or empty --summary or --model (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const noVerdict = yield* h.run([
          "diagnose",
          "--session-id",
          SESSION_ID,
          "--type",
          bootHang.key,
          "--summary",
          "s",
          "--model",
          MODEL,
        ]);
        expect(helpErrors(noVerdict).join("\n")).toMatch(/Missing required flag: --verdict/);
        const badVerdict = yield* h.run([
          "diagnose",
          "--session-id",
          SESSION_ID,
          "--verdict",
          "succeeded",
          "--summary",
          "s",
          "--model",
          MODEL,
        ]);
        expect(helpErrors(badVerdict).join("\n")).toMatch(
          /Invalid value for flag --verdict: "succeeded"/,
        );
        const badType = yield* h.run([
          "diagnose",
          "--session-id",
          SESSION_ID,
          "--verdict",
          "failed",
          "--type",
          "Guest Boot",
          "--summary",
          "s",
          "--model",
          MODEL,
        ]);
        expect(helpErrors(badType).join("\n")).toMatch(
          /key must be snake_case: a-z, 0-9 and _, starting with a letter/,
        );
        const noSummary = yield* h.run([
          "diagnose",
          "--session-id",
          SESSION_ID,
          "--verdict",
          "failed",
          "--type",
          bootHang.key,
          "--model",
          MODEL,
        ]);
        expect(helpErrors(noSummary).join("\n")).toMatch(/Missing required flag: --summary/);
        const emptyModel = yield* h.run([
          "diagnose",
          "--session-id",
          SESSION_ID,
          "--verdict",
          "failed",
          "--type",
          bootHang.key,
          "--summary",
          "s",
          "--model",
          "",
        ]);
        expect(helpErrors(emptyModel).join("\n")).toMatch(/--model.*length of at least 1/s);
        expect(h.touched).toEqual([]);
      }),
  );
});

// ---------------------------------------------------------------------------
// session inspect
// ---------------------------------------------------------------------------

const debugLog = {
  sessionId: SESSION_ID,
  sources: {
    serial: "omarchy login: ",
    proxy: "2026-09-03T00:00:03.000Z info stopped; failed; installer hung",
    qemu: "",
    actions:
      '2026-09-03T00:00:01.000Z 1 completed {"execute":"qmp_capabilities","arguments":{},"id":1} {"return":{}}',
  },
  createdAt: new Date("2026-09-03T00:00:04Z"),
};

const IMAGE_ID = "4d1c0f9e-6e1a-4c0b-9f0e-6b3f0e1c2d3a";

const testRun: typeof DbSchema.testRuns.$inferSelect = {
  id: RUN_ID,
  name: "Omarchy experiment",
  iso: "https://example.com/omarchy.iso",
  serverUrl: SERVER,
  status: "pending",
  reason: null,
  startedAt: new Date("2026-09-03T00:00:00Z"),
  endedAt: null,
};

const seedInspect = (h: ReturnType<typeof harness>) => {
  h.stores.sessions.sessions.push(session(SESSION_ID, "succeeded", ago(500)));
  h.stores.tests.definitions.push(install);
  h.stores.tests.runs.push(testRun);
  h.stores.logs.rows.push(
    { text: "starting; iso omarchy.iso", level: "info", sessionId: SESSION_ID, agentId: "OLI-42" },
    { text: "unrelated", level: "info", sessionId: OTHER_SESSION_ID, agentId: null },
  );
  h.stores.actions.actions.push({
    id: 1,
    sessionId: SESSION_ID,
    agentId: "OLI-42",
    request: { execute: "qmp_capabilities", arguments: {}, id: 1 },
    state: "completed",
    response: { return: {} },
    createdAt: new Date("2026-09-03T00:00:01Z"),
    finishedAt: new Date("2026-09-03T00:00:02Z"),
  });
  h.stores.actions.images.push({ id: IMAGE_ID, actionId: 1, data: new Uint8Array([0x89]) });
};

describe("session inspect", () => {
  it.effect("--logs prints the bare array of the session's logs (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--logs"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      const printed = yield* lastJson;
      expect(Array.isArray(printed)).toBe(true);
      expect(printed).toHaveLength(1);
      expect(printed[0]).toMatchObject({
        text: "starting; iso omarchy.iso",
        sessionId: SESSION_ID,
      });
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("--actions prints the bare array and --test-def the bare definition (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
      expect(
        Exit.isSuccess(yield* h.run(["session", "--session-id", SESSION_ID, "--actions"])),
      ).toBe(true);
      const actions = yield* lastJson;
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ id: 1, sessionId: SESSION_ID, state: "completed" });
      expect(
        Exit.isSuccess(yield* h.run(["session", "--session-id", SESSION_ID, "--test-def"])),
      ).toBe(true);
      expect(yield* lastJson).toEqual({ ...install, createdAt: install.createdAt.toISOString() });
    }),
  );

  it.effect("several selectors print an object with one key per selector (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--logs",
        "--test-results",
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      const printed = yield* lastJson;
      expect(Object.keys(printed)).toEqual(["logs", "results"]);
      expect(printed.results).toMatchObject({ id: RESULT_ID, status: "passed" });
    }),
  );

  it.effect(
    "--all prints { session, logs, results, test_definition, test_run, actions, images, debug_log, diagnosis } (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        seedInspect(h);
        h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
        h.stores.debugLogs.rows.set(SESSION_ID, debugLog);
        h.stores.diagnosis.errorTypes.push(bootHang);
        h.stores.diagnosis.diagnoses.push(diagnosis);
        const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--all"]);
        expect(Exit.isSuccess(exit)).toBe(true);
        const printed = yield* lastJson;
        expect(Object.keys(printed)).toEqual([
          "session",
          "logs",
          "results",
          "test_definition",
          "test_run",
          "actions",
          "images",
          "debug_log",
          "diagnosis",
        ]);
        expect(printed.session).toMatchObject({ id: SESSION_ID, status: "succeeded" });
        expect(printed.test_definition).toMatchObject({ name: "Install Omarchy" });
        expect(printed.test_run).toEqual({
          ...testRun,
          startedAt: testRun.startedAt.toISOString(),
        });
        expect(printed.actions).toHaveLength(1);
        expect(printed.images).toEqual([
          {
            id: IMAGE_ID,
            actionId: 1,
            url: Contract.StoredImageUrl(IMAGE_ID),
            createdAt: "2026-09-03T00:00:01.000Z",
          },
        ]);
        expect(printed.debug_log).toEqual({
          ...debugLog,
          createdAt: debugLog.createdAt.toISOString(),
        });
        expect(printed.diagnosis).toEqual({
          ...diagnosis,
          createdAt: diagnosis.createdAt.toISOString(),
        });
      }),
  );

  it.effect(
    "--status prints the bare session row: the driver's verdict and what it booted (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        seedInspect(h);
        const row = h.stores.sessions.sessions[0];
        if (row !== undefined) {
          row.reason = "lock screen on screen";
          row.endedAt = ago(100);
        }
        const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--status"]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* lastJson).toEqual({
          id: SESSION_ID,
          config: { iso: "omarchy.iso" },
          status: "succeeded",
          reason: "lock screen on screen",
          startedAt: ago(500).toISOString(),
          endedAt: ago(100).toISOString(),
        });
      }),
  );

  it.effect(
    "--test-run prints the bare run the result belongs to, null without a result (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        seedInspect(h);
        const none = yield* h.run(["session", "--session-id", SESSION_ID, "--test-run"]);
        expect(Exit.isSuccess(none)).toBe(true);
        expect(yield* stdout).toEqual(["null"]);
        h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
        const some = yield* h.run(["session", "--session-id", SESSION_ID, "--test-run"]);
        expect(Exit.isSuccess(some)).toBe(true);
        expect(yield* lastJson).toEqual({ ...testRun, startedAt: testRun.startedAt.toISOString() });
      }),
  );

  it.effect(
    "--images prints every screenshot with its url, oldest first, [] without any (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        seedInspect(h);
        h.stores.actions.actions.push({
          id: 2,
          sessionId: SESSION_ID,
          agentId: "OLI-42",
          request: {
            execute: "screendump",
            arguments: { filename: "/tmp/s.png", format: "png" },
            id: 2,
          },
          state: "completed",
          response: { return: {} },
          createdAt: new Date("2026-09-03T00:00:03Z"),
          finishedAt: new Date("2026-09-03T00:00:04Z"),
        });
        // Another session's screenshot must not leak into this one's list.
        h.stores.actions.actions.push({
          id: 3,
          sessionId: OTHER_SESSION_ID,
          agentId: "OLI-43",
          request: {
            execute: "screendump",
            arguments: { filename: "/tmp/o.png", format: "png" },
            id: 3,
          },
          state: "completed",
          response: { return: {} },
          createdAt: new Date("2026-09-03T00:00:00Z"),
          finishedAt: new Date("2026-09-03T00:00:00Z"),
        });
        const later = "5e2d1a0f-7f2b-4d1c-8a1f-7c4a1f2d3e4b";
        const other = "6f3e2b1a-8a3c-4e2d-9b2a-8d5b2a3e4f5c";
        h.stores.actions.images.push(
          { id: later, actionId: 2, data: new Uint8Array([0x89]) },
          { id: other, actionId: 3, data: new Uint8Array([0x89]) },
        );
        const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--images"]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* lastJson).toEqual([
          {
            id: IMAGE_ID,
            actionId: 1,
            url: Contract.StoredImageUrl(IMAGE_ID),
            createdAt: "2026-09-03T00:00:01.000Z",
          },
          {
            id: later,
            actionId: 2,
            url: Contract.StoredImageUrl(later),
            createdAt: "2026-09-03T00:00:03.000Z",
          },
        ]);

        const bare = harness();
        bare.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
        const empty = yield* bare.run(["session", "--session-id", SESSION_ID, "--images"]);
        expect(Exit.isSuccess(empty)).toBe(true);
        expect((yield* stdout).at(-1)).toBe("[]");
      }),
  );

  it.effect("--diagnosis prints the bare diagnosis row, null when there is none (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const none = yield* h.run(["session", "--session-id", SESSION_ID, "--diagnosis"]);
      expect(Exit.isSuccess(none)).toBe(true);
      expect(yield* stdout).toEqual(["null"]);
      h.stores.diagnosis.errorTypes.push(bootHang);
      h.stores.diagnosis.diagnoses.push(diagnosis);
      const some = yield* h.run(["session", "--session-id", SESSION_ID, "--diagnosis"]);
      expect(Exit.isSuccess(some)).toBe(true);
      expect(yield* lastJson).toEqual({
        ...diagnosis,
        createdAt: diagnosis.createdAt.toISOString(),
      });
    }),
  );

  it.effect("--diagnosis on an unknown session is a failure (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const error = yield* h.fail(["session", "--session-id", OTHER_SESSION_ID, "--diagnosis"]);
      expect(error).toMatchObject({
        _tag: "CommandError",
        message: `session: no session ${OTHER_SESSION_ID}`,
      });
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("--debug-logs prints the bare debug log row (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.debugLogs.rows.set(SESSION_ID, debugLog);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--debug-logs"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      const printed = yield* lastJson;
      expect(printed).toEqual({ ...debugLog, createdAt: debugLog.createdAt.toISOString() });
      expect(printed.sources.serial).toBe("omarchy login: ");
    }),
  );

  it.effect("--debug-logs prints null when the session has none (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--debug-logs"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["null"]);
    }),
  );

  it.effect("--debug-logs on an unknown session is a failure (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", OTHER_SESSION_ID, "--debug-logs"]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: `session: no session ${OTHER_SESSION_ID}`,
      });
    }),
  );

  it.effect("--test-results prints null when the session has none (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--test-results"]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["null"]);
    }),
  );

  it.effect("requires a selector (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message:
          "session: --status, --logs, --test-def, --test-results, --test-run, --actions, --images, --debug-logs, --diagnosis, or --all is required",
      });
    }),
  );

  it.effect("--dump is gone: the console lives in --debug-logs, never on a proxy (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--dump"], {
        ...WITH_DB,
        OLIGARCHY_TOKEN: "t",
      });
      expect(helpErrors(exit).join("\n")).toMatch(/Unrecognized flag: --dump/);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("needs DATABASE_URL alone: no proxy token, no proxy url (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--logs"], {
        ...WITH_DB,
        OLIGARCHY_TOKEN: "",
        SERVER_URL: "",
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(Array.isArray(yield* lastJson)).toBe(true);
    }),
  );

  it.effect("rejects an unknown session (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--logs"]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: `session: no session ${SESSION_ID}`,
      });
    }),
  );

  it.effect("rejects a session with two test results (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.tests.results.push(
        result(RESULT_ID, "passed", SESSION_ID),
        result(OTHER_RESULT_ID, "failed", SESSION_ID),
      );
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--test-results"]);
      expect(failure(exit)).toMatchObject({
        message: `session: multiple test results for ${SESSION_ID}`,
      });
    }),
  );

  it.effect("rejects --active and --count on inspection (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const active = yield* h.run(["session", "--session-id", SESSION_ID, "--logs", "--active"]);
      expect(helpErrors(active).join("\n")).toMatch(/Unrecognized flag: --active/);
      const count = yield* h.run(["session", "--session-id", SESSION_ID, "--logs", "--count", "3"]);
      expect(helpErrors(count).join("\n")).toMatch(/Unrecognized flag: --count/);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// session --search
// ---------------------------------------------------------------------------

// The other way round from inspection: a result id in, the session that ran it out, as one bare
// line a shell can capture into SESSION_ID.
const SEARCH = ["session", "--search", `--test-result-id=${RESULT_ID}`];

describe("session --search", () => {
  it.effect("prints the bare id of the session a result ran in (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(
        result(OTHER_RESULT_ID, "passed", OTHER_SESSION_ID),
        result(RESULT_ID, "passed", SESSION_ID),
      );
      const exit = yield* h.run(SEARCH);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual([SESSION_ID]);
      expect(h.log.lines).toEqual([]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("finds a result still running, with --test-result-id spaced (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(result(RESULT_ID, "running", SESSION_ID));
      const exit = yield* h.run(["session", "--search", "--test-result-id", RESULT_ID]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual([SESSION_ID]);
    }),
  );

  it.effect("--session-id and SESSION_ID have no say: the result names the session (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
      const flagged = yield* h.run([...SEARCH, "--session-id", OTHER_SESSION_ID]);
      expect(Exit.isSuccess(flagged)).toBe(true);
      const fromEnv = yield* h.run(SEARCH, { ...WITH_DB, SESSION_ID: OTHER_SESSION_ID });
      expect(Exit.isSuccess(fromEnv)).toBe(true);
      expect(yield* stdout).toEqual([SESSION_ID, SESSION_ID]);
    }),
  );

  it.effect("rejects a result nobody has (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(result(OTHER_RESULT_ID, "passed", SESSION_ID));
      expect(yield* h.fail(SEARCH)).toMatchObject({
        _tag: "CommandError",
        message: `session: no test result ${RESULT_ID}`,
      });
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("rejects a result no session has run yet (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(result(RESULT_ID, "pending", null));
      expect(yield* h.fail(SEARCH)).toMatchObject({
        _tag: "CommandError",
        message: `session: result ${RESULT_ID} has no session yet`,
      });
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("--search needs --test-result-id, and --test-result-id needs --search (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
      expect(yield* h.fail(["session", "--search"])).toMatchObject({
        _tag: "CommandError",
        message: "session: --search needs --test-result-id",
      });
      expect(
        yield* h.fail([
          "session",
          "--session-id",
          SESSION_ID,
          "--test-result-id",
          RESULT_ID,
          "--logs",
        ]),
      ).toMatchObject({
        _tag: "CommandError",
        message: "session: --test-result-id needs --search",
      });
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("--search takes no selector: inspection goes through the id it prints (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
      expect(yield* h.fail([...SEARCH, "--all"])).toMatchObject({
        _tag: "CommandError",
        message: "session: --search takes no selector",
      });
      expect(yield* h.fail([...SEARCH, "--logs", "--status"])).toMatchObject({
        message: "session: --search takes no selector",
      });
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("rejects an empty --test-result-id before touching the database (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["session", "--search", "--test-result-id", ""]);
      expect(helpErrors(exit).join("\n")).toMatch(/--test-result-id.*length of at least 1/s);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// Environment, server url, help
// ---------------------------------------------------------------------------

describe("environment order", () => {
  it.effect(
    "reports DATABASE_URL before LINEAR_API_TOKEN, and both only after parsing (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const nothing = yield* h.run([...NEW, "--server-url", SERVER], {});
        expect(failure(nothing)).toMatchObject({
          _tag: "MissingVariable",
          message: "DATABASE_URL is not set",
        });
        const noLinear = yield* h.run([...NEW, "--server-url", SERVER], {
          ...WITH_DB,
          LINEAR_API_TOKEN: "",
        });
        expect(failure(noLinear)).toMatchObject({ message: "LINEAR_API_TOKEN is not set" });
        const parseFirst = yield* h.run(
          [
            "test",
            "new",
            "--iso",
            "http://x.example/o.iso",
            "--version",
            "1",
            "--server-url",
            SERVER,
          ],
          {},
        );
        expect(helpErrors(parseFirst).join("\n")).toMatch(/iso must be a valid https url/);
        expect(h.touched).toEqual([]);
      }),
  );

  it.effect(
    "rejects a missing DATABASE_URL before doing anything, on every database action (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        for (const args of [
          ["test", "--list"],
          ["test", "list"],
          [
            "test",
            "start",
            "--session-id",
            SESSION_ID,
            "--test-result-id",
            RESULT_ID,
            "--model",
            MODEL,
          ],
          ["test-results", "--agent-id", "a", "--id", RESULT_ID, "--status", "success"],
          ["session", "list"],
          ["session", "--session-id", SESSION_ID, "--logs"],
          SEARCH,
          NEW_TYPE,
          ["error-type", "list"],
          DIAGNOSE,
        ]) {
          const exit = yield* h.run(args, {
            DATABASE_URL: "",
            LINEAR_API_TOKEN: "l",
          });
          expect(failure(exit)).toMatchObject({
            _tag: "MissingVariable",
            message: "DATABASE_URL is not set",
          });
        }
        expect(h.touched).toEqual([]);
        expect(yield* stdout).toEqual([]);
      }),
  );
});

// The proxy url is data on test new alone: stored on the run and written into every ticket for the
// drivers' ./client. Every other action reads the database and has no proxy to name; test start
// and test-results still accept it unread, because tickets written before it went name it.
describe("--server-url", () => {
  const TEST_START = [
    "test",
    "start",
    "--session-id",
    SESSION_ID,
    "--test-result-id",
    RESULT_ID,
    "--model",
    MODEL,
  ];
  const TEST_RESULTS = [
    "test-results",
    "--agent-id",
    "a",
    "--id",
    RESULT_ID,
    "--status",
    "success",
  ];

  const withServer: ReadonlyArray<ReadonlyArray<string>> = [
    ["test", "--list"],
    ["test", "--list", "--history"],
    ["test", "define", "--name", "Change lighting", "--proof", "p"],
    ["test", "list"],
    ["session", "list"],
    ["session", "--session-id", SESSION_ID, "--logs"],
    SEARCH,
    NEW_TYPE,
    ["error-type", "list"],
    DIAGNOSE,
  ].map((args) => [...args, "--server-url", SERVER]);

  it.effect("is required on test new (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(NEW, { ...WITH_LINEAR, SERVER_URL: "" });
      expect(helpErrors(exit).join("\n")).toMatch(/Missing required flag: --server-url/);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect(
    "is unrecognized on every action but test new, test start and test-results (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        for (const args of withServer) {
          const exit = yield* h.run(args, WITH_LINEAR);
          expect(helpErrors(exit).join("\n"), args.join(" ")).toMatch(
            /Unrecognized flag: --server-url/,
          );
        }
        expect(h.touched).toEqual([]);
      }),
  );

  it.effect(
    "is accepted unread by test start and test-results: a ticket written before it went still runs (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        h.stores.sessions.sessions.push(session(SESSION_ID, "running", ago(10)));
        h.stores.sessions.agentRuns.push({
          agentId: "a",
          sessionId: SESSION_ID,
          startedAt: ago(10),
          endedAt: null,
        });
        h.stores.tests.results.push(result(RESULT_ID, "pending", null));
        // Not even a url: the value is never read, so it is never checked.
        const legacy = ["--server-url", "not a url"];
        expect(Exit.isSuccess(yield* h.run([...TEST_START, ...legacy]))).toBe(true);
        expect(h.stores.tests.results[0]).toMatchObject({ status: "running", model: MODEL });
        expect(Exit.isSuccess(yield* h.run([...TEST_RESULTS, ...legacy]))).toBe(true);
        expect(h.stores.tests.results[0]).toMatchObject({
          status: "passed",
          sessionId: SESSION_ID,
        });
        expect(h.log.lines.map((line) => line.text)).toEqual([
          `test result ${RESULT_ID}: running`,
          `test result ${RESULT_ID}: passed`,
        ]);
      }),
  );

  it.effect("SERVER_URL in the environment is ignored by every action but test new (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      h.stores.sessions.agentRuns.push({
        agentId: "a",
        sessionId: SESSION_ID,
        startedAt: ago(500),
        endedAt: ago(400),
      });
      h.stores.tests.results.push(result(RESULT_ID, "pending", null));
      // A value test new's flag would refuse: nothing else reads it. The result is started
      // before it is closed; NEW_TYPE mints the key DIAGNOSE then writes.
      const env = { ...WITH_LINEAR, SERVER_URL: "ftp://env.example" };
      for (const args of [
        ["test", "--list"],
        ["test", "list"],
        TEST_START,
        TEST_RESULTS,
        ["session", "list"],
        ["session", "--session-id", SESSION_ID, "--logs"],
        SEARCH,
        NEW_TYPE,
        ["error-type", "list"],
        DIAGNOSE,
      ]) {
        expect(Exit.isSuccess(yield* h.run(args, env)), args.join(" ")).toBe(true);
      }
    }),
  );

  it.effect(
    "rejects a URL outside HTTP and HTTPS from the flag and from SERVER_URL (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const flag = yield* h.run([...NEW, "--server-url=ftp://qemu.example.com"], WITH_LINEAR);
        expect(helpErrors(flag).join("\n")).toMatch(/server-url must be a valid http or https url/);
        const env = yield* h.run(NEW, { ...WITH_LINEAR, SERVER_URL: "ftp://qemu.example.com" });
        expect(helpErrors(env).join("\n")).toMatch(/server-url must be a valid http or https url/);
        const hostless = yield* h.run([...NEW, "--server-url=http://"], WITH_LINEAR);
        expect(helpErrors(hostless).join("\n")).toMatch(
          /server-url must be a valid http or https url/,
        );
        expect(h.touched).toEqual([]);
      }),
  );

  it.effect("prefers the flag over SERVER_URL (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const bad = yield* h.run([...NEW, "--server-url=ssh://flag.example"], {
        ...WITH_LINEAR,
        SERVER_URL: SERVER,
      });
      expect(helpErrors(bad).join("\n")).toMatch(/server-url must be a valid http or https url/);
      h.stores.tests.definitions.push(install);
      const good = yield* h.run([...NEW, `--server-url=${SERVER}`], {
        ...WITH_LINEAR,
        SERVER_URL: "ftp://env.example",
      });
      expect(Exit.isSuccess(good)).toBe(true);
      expect(h.stores.tests.runs[0]?.serverUrl).toBe(SERVER);
    }),
  );
});

// The session a command is about may come from the environment: SESSION_ID stands in for
// --session-id on every action that takes it, and the flag wins when both are given.
describe("SESSION_ID", () => {
  const WITH_SESSION = { ...WITH_DB, SESSION_ID };

  it.effect("stands in for --session-id on session (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--status"], WITH_SESSION);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toMatchObject({ id: SESSION_ID, status: "succeeded" });
    }),
  );

  it.effect("stands in for --session-id on test start (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "running", ago(10)));
      h.stores.tests.results.push(result(RESULT_ID, "pending", null));
      const exit = yield* h.run(
        ["test", "start", "--test-result-id", RESULT_ID, "--model", MODEL],
        WITH_SESSION,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.stores.tests.results[0]).toMatchObject({
        status: "running",
        sessionId: SESSION_ID,
        model: MODEL,
      });
      expect(h.log.lines.map((line) => [line.text, line.sessionId])).toEqual([
        [`test result ${RESULT_ID}: running`, SESSION_ID],
      ]);
    }),
  );

  it.effect("stands in for --session-id on diagnose (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      h.stores.diagnosis.errorTypes.push(bootHang);
      const written = yield* h.run(
        [
          "diagnose",
          "--verdict",
          "failed",
          "--type",
          bootHang.key,
          "--summary",
          diagnosis.summary,
          "--model",
          MODEL,
        ],
        WITH_SESSION,
      );
      expect(Exit.isSuccess(written)).toBe(true);
      expect(h.stores.diagnosis.diagnoses.map((row) => row.sessionId)).toEqual([SESSION_ID]);
      expect(h.log.lines.map((line) => line.sessionId)).toEqual([SESSION_ID]);
    }),
  );

  it.effect("the flag wins over SESSION_ID (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.sessions.sessions.push(session(OTHER_SESSION_ID, "failed", ago(100)));
      const exit = yield* h.run(
        ["session", "--session-id", OTHER_SESSION_ID, "--status"],
        WITH_SESSION,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toMatchObject({ id: OTHER_SESSION_ID, status: "failed" });
    }),
  );

  it.effect(
    "session with neither is refused before the selector check, an empty SESSION_ID counting as unset (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        seedInspect(h);
        expect(yield* h.fail(["session", "--status"])).toMatchObject({
          _tag: "CommandError",
          message: "session: --session-id or SESSION_ID is required",
        });
        expect(
          yield* h.fail(["session", "--status"], { ...WITH_DB, SESSION_ID: "" }),
        ).toMatchObject({
          _tag: "CommandError",
          message: "session: --session-id or SESSION_ID is required",
        });
        expect(yield* h.fail(["session"])).toMatchObject({
          message: "session: --session-id or SESSION_ID is required",
        });
        expect(yield* stdout).toEqual([]);
      }),
  );

  it.effect(
    "test start and diagnose with neither are usage errors that touch nothing (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        for (const args of [
          ["test", "start", "--test-result-id", RESULT_ID, "--model", MODEL],
          ["diagnose", "--verdict", "passed", "--summary", "s", "--model", MODEL],
        ]) {
          const exit = yield* h.run(args, { ...WITH_DB, SESSION_ID: "" });
          expect(helpErrors(exit).join("\n"), args.join(" ")).toMatch(
            /Missing required flag: --session-id/,
          );
        }
        expect(h.touched).toEqual([]);
      }),
  );
});

describe("--help", () => {
  it.effect(
    "on the root, test, session and every subcommand touches nothing and exits 0 (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        for (const args of [
          ["--help"],
          ["test", "--help"],
          ["test", "define", "--help"],
          ["test", "new", "--help"],
          ["test", "list", "--help"],
          ["test", "start", "--help"],
          ["test-results", "--help"],
          ["session", "--help"],
          ["session", "list", "--help"],
          ["error-type", "--help"],
          ["error-type", "new", "--help"],
          ["error-type", "list", "--help"],
          ["diagnose", "--help"],
        ]) {
          // The built-in --help renders and succeeds; runMain exits 0.
          const exit = yield* h.run(args, {});
          expect(Exit.isSuccess(exit)).toBe(true);
        }
        expect(h.touched).toEqual([]);
        const printed = (yield* stdout).join("\n");
        expect(printed).toMatch(/test-results/);
        expect(printed).toMatch(/session/);
        expect(printed).toMatch(/error-type/);
        expect(printed).toMatch(/diagnose/);
        expect(printed.includes("--dump")).toBe(false);
      }),
  );

  it.effect(
    "bare ctrl prints help and exits 0; an unknown action is a usage error (changed: R3)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const bare = yield* h.run([], {});
        expect(helpErrors(bare)).toEqual([]);
        const unknown = yield* h.run(["reboot"], {});
        expect(helpErrors(unknown).length).toBeGreaterThan(0);
        expect(h.touched).toEqual([]);
      }),
  );
});
