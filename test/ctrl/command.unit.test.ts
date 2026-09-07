import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem, NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Layer, Redacted } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { CliError, Command } from "effect/unstable/cli";
import * as CtrlCommand from "../../src/ctrl/command.ts";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Api from "../../src/shared/api.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Config from "../support/config.ts";
import * as FakeCursor from "../support/fake-cursor.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import * as FakeLog from "../support/log.ts";
import * as StdioSupport from "../support/stdio.ts";
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
// The proxy seam: `session --dump` connects and reads one dump.
// ---------------------------------------------------------------------------

type DumpCall = { readonly serverUrl: string; readonly token: string; readonly id: string };

type FakeProxy = {
  readonly calls: Array<DumpCall>;
  readonly connect: CtrlCommand.ConnectProxy;
};

const fakeProxy = (
  script: {
    readonly bytes?: Uint8Array;
    readonly failure?: Errors.ProxyRefusal | Errors.ProxyUnreachable;
  } = {},
): FakeProxy => {
  const calls: Array<DumpCall> = [];
  return {
    calls,
    connect: ({ serverUrl, token }) =>
      Effect.succeed({
        dump: (id) =>
          Effect.suspend(() => {
            calls.push({ serverUrl, token: Redacted.value(token), id });
            return script.failure === undefined
              ? Effect.succeed(script.bytes ?? new Uint8Array())
              : Effect.fail(script.failure);
          }),
      }),
  };
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const harness = (
  options: {
    readonly linear?: FakeLinear.FakeLinear;
    readonly cursor?: FakeCursor.FakeCursor;
    readonly proxy?: FakeProxy;
    // Replaces the real FileSystem the prompt templates are read from.
    readonly fs?: Layer.Layer<FileSystem.FileSystem>;
  } = {},
) => {
  const stores = Stores.fakeStores();
  const log = FakeLog.fakeLog();
  const linear = options.linear ?? FakeLinear.fakeLinear();
  const cursor = options.cursor ?? FakeCursor.fakeCursor();
  const proxy = options.proxy ?? fakeProxy();
  const touched: Array<string> = [];
  const stdio = StdioSupport.capture();
  const command = CtrlCommand.makeCtrlCommand({
    database: () => {
      touched.push("database");
      return Layer.mergeAll(stores.layer, log.layer);
    },
    linear: () => {
      touched.push("linear");
      return linear.layer;
    },
    cursor: () => {
      touched.push("cursor");
      return cursor.layer;
    },
    proxy: proxy.connect,
  });
  // A later layer's service wins the merge, so the fake FileSystem replaces Node's.
  const services =
    options.fs === undefined ? NodeServices.layer : Layer.merge(NodeServices.layer, options.fs);
  const program = (args: ReadonlyArray<string>, env: Record<string, string>) =>
    Command.runWith(command, { version: Api.VERSION })(args).pipe(
      Effect.provide(Layer.mergeAll(services, stdio.layer, Config.withEnv(env), FakeHttp.die)),
    );
  const run = (args: ReadonlyArray<string>, env: Record<string, string> = WITH_DB) =>
    Effect.exit(program(args, env));
  // The failure itself, for a command refused after parsing.
  const fail = (args: ReadonlyArray<string>, env: Record<string, string> = WITH_DB) =>
    Effect.flip(program(args, env));
  return { stores, log, linear, cursor, proxy, touched, stdio, run, fail };
};

const DRIVING_AGENT_PATH = /\/prompts\/driving-agent\.html$/;
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
      const exit = yield* h.run(["test", "--list", "--server-url", SERVER]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["Install Omarchy", "Open a terminal"]);
      expect(h.touched).toEqual(["database"]);
    }),
  );

  it.effect("prints nothing when there are no definitions (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["test", "--list", "--server-url", SERVER]);
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
        const exit = yield* h.run([
          "test",
          "--list",
          "--details",
          "--name",
          "Open a terminal",
          "--server-url",
          SERVER,
        ]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* lastJson).toEqual([
          { ...terminal, createdAt: terminal.createdAt.toISOString() },
        ]);
      }),
  );

  it.effect("takes the server from SERVER_URL when the flag is absent (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      const exit = yield* h.run(["test", "--list", "--name", "Install Omarchy"], {
        ...WITH_DB,
        SERVER_URL: SERVER,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["Install Omarchy"]);
    }),
  );

  it.effect("rejects a name that matches no definition (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.tests.definitions.push(install);
      const exit = yield* h.run([
        "test",
        "--list",
        "--name",
        "missing-definition",
        "--server-url",
        SERVER,
      ]);
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
      const exit = yield* h.run(["test", "--server-url", SERVER]);
      expect(helpErrors(exit).join("\n")).toMatch(/Missing required flag: --list/);
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
        expect(fs.reads.some((path) => DRIVING_AGENT_PATH.test(path))).toBe(false);
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
      const exit = yield* h.run(["test", "list", "--server-url", SERVER], WITH_LINEAR);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toEqual(backlog);
      expect(h.linear.calls).toEqual([{ method: "listBacklog" }]);
      expect(h.touched).toEqual(["database", "linear"]);
    }),
  );

  it.effect("prints [] for an empty backlog (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["test", "list", "--server-url", SERVER], WITH_LINEAR);
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
      const exit = yield* h.run(["test", "list", "--server-url", SERVER], WITH_LINEAR);
      expect(failure(exit)).toBe(refused);
      expect(yield* stdout).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// test run
// ---------------------------------------------------------------------------

const WITH_CURSOR = { ...WITH_DB, CURSOR_API_TOKEN: "cursor-token" };

describe("test run", () => {
  it.effect("kicks off the driving agent with the ticket prompt and prints its link (happy)", () =>
    Effect.gen(function* () {
      const h = harness({ cursor: FakeCursor.fakeCursor({ agentId: "bc-42" }) });
      const exit = yield* h.run(["test", "run", "--ticket", "OLI-42"], WITH_CURSOR);
      expect(Exit.isSuccess(exit)).toBe(true);
      // Without --model the agent runs on the default, and the prompt names that default so the
      // driver records it at test start.
      expect(h.cursor.calls).toEqual([
        {
          text: yield* rendered("driving-agent.html", {
            LINEAR_TICKET: "OLI-42",
            MODEL: "grok-4.6-xhigh-fast",
          }),
          model: undefined,
        },
      ]);
      expect(h.cursor.calls[0]?.text).toMatch(/Review Linear ticket\s+OLI-42/);
      expect(h.cursor.calls[0]?.text).toContain("<model> grok-4.6-xhigh-fast </model>");
      expect(h.cursor.calls[0]?.text.includes(SERVER)).toBe(false);
      expect(yield* stdout).toEqual([
        "Agent here, go check it out for more information: https://cursor.com/agents/bc-42",
      ]);
      expect(h.touched).toEqual(["database", "cursor"]);
    }),
  );

  it.effect("--model runs the agent on that model and names it in the prompt (happy)", () =>
    Effect.gen(function* () {
      const h = harness({ cursor: FakeCursor.fakeCursor({ agentId: "bc-43" }) });
      const exit = yield* h.run(
        ["test", "run", "--ticket", "OLI-42", "--model", "composer-2.5"],
        WITH_CURSOR,
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.cursor.calls).toEqual([
        {
          text: yield* rendered("driving-agent.html", {
            LINEAR_TICKET: "OLI-42",
            MODEL: "composer-2.5",
          }),
          model: { id: "composer-2.5" },
        },
      ]);
      expect(h.cursor.calls[0]?.text).toContain("--model composer-2.5");
    }),
  );

  it.effect("an empty --model is refused before any agent starts (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness({ cursor: FakeCursor.fakeCursor({ agentId: "bc-44" }) });
      const exit = yield* h.run(["test", "run", "--ticket", "OLI-42", "--model", ""], WITH_CURSOR);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(h.cursor.calls).toEqual([]);
    }),
  );

  // v1 read prompts/driving-agent.html alone here; the guides `test new` embeds are not its
  // business, so a checkout with an unreadable client.md still kicks the agent off.
  it.effect(
    "reads only the kickoff template: an unreadable client.md does not stop it (happy)",
    () =>
      Effect.gen(function* () {
        const fs = promptFs(/\/client\.md$/);
        const h = harness({ cursor: FakeCursor.fakeCursor({ agentId: "bc-42" }), fs: fs.layer });
        const exit = yield* h.run(["test", "run", "--ticket", "OLI-42"], WITH_CURSOR);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(fs.reads).toHaveLength(1);
        expect(fs.reads[0]).toMatch(DRIVING_AGENT_PATH);
        expect(h.cursor.calls).toEqual([
          { text: "Review Linear ticket OLI-42\n", model: undefined },
        ]);
      }),
  );

  it.effect("fails naming the kickoff template when it is unreadable (unhappy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(DRIVING_AGENT_PATH);
      const h = harness({ cursor: FakeCursor.fakeCursor({ agentId: "bc-42" }), fs: fs.layer });
      const exit = yield* h.run(["test", "run", "--ticket", "OLI-42"], WITH_CURSOR);
      expect(failure(exit)).toMatchObject({
        _tag: "PromptError",
        message: expect.stringMatching(/^prompt: .*driving-agent\.html/),
      });
      expect(h.cursor.calls).toEqual([]);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("takes no server URL: --server-url is unrecognized (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(
        ["test", "run", "--ticket", "OLI-42", `--server-url=${SERVER}`],
        WITH_CURSOR,
      );
      expect(helpErrors(exit).join("\n")).toMatch(/Unrecognized flag: --server-url/);
      expect(h.cursor.calls).toEqual([]);
      expect(yield* stdout).not.toContain(expect.stringContaining("Agent here"));
    }),
  );

  it.effect("rejects a missing or empty ticket (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const missing = yield* h.run(["test", "run"], WITH_CURSOR);
      expect(helpErrors(missing).join("\n")).toMatch(/Missing required flag: --ticket/);
      const empty = yield* h.run(["test", "run", "--ticket", ""], WITH_CURSOR);
      expect(helpErrors(empty).join("\n")).toMatch(/--ticket.*length of at least 1/s);
      expect(h.cursor.calls).toEqual([]);
    }),
  );

  it.effect("requires CURSOR_API_TOKEN after parsing and before any call (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run(["test", "run", "--ticket", "OLI-42"], {
        ...WITH_DB,
        CURSOR_API_TOKEN: "",
      });
      expect(failure(exit)).toMatchObject({
        _tag: "MissingVariable",
        message: "CURSOR_API_TOKEN is not set",
      });
      expect(h.cursor.calls).toEqual([]);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("surfaces the SDK's refusal and prints nothing (unhappy)", () =>
    Effect.gen(function* () {
      const refused = Errors.CursorAgentFailed.make({
        message: "Invalid API key",
        retryable: false,
        cause: new Error("Invalid API key"),
      });
      const h = harness({ cursor: FakeCursor.fakeCursor({ failure: refused }) });
      const exit = yield* h.run(["test", "run", "--ticket", "OLI-42"], WITH_CURSOR);
      expect(failure(exit)).toBe(refused);
      expect(yield* stdout).toEqual([]);
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
          "--server-url",
          SERVER,
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
        "--server-url",
        SERVER,
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
      const noAgent = yield* h.run([
        "test-results",
        "--id",
        RESULT_ID,
        "--status",
        "success",
        "--server-url",
        SERVER,
      ]);
      expect(helpErrors(noAgent).join("\n")).toMatch(/Missing required flag: --agent-id/);
      const badStatus = yield* h.run([
        "test-results",
        "--agent-id",
        "a",
        "--id",
        RESULT_ID,
        "--status",
        "passed",
        "--server-url",
        SERVER,
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
      const exit = yield* h.run(["session", "list", "--server-url", SERVER]);
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
      const exit = yield* h.run(["session", "list", "--count=1"], {
        ...WITH_DB,
        SERVER_URL: SERVER,
      });
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
      const exit = yield* h.run([
        "session",
        "list",
        "--active",
        "--json",
        "--count",
        "10",
        "--server-url",
        SERVER,
      ]);
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
      expect(
        Exit.isSuccess(yield* h.run(["session", "list", "--json", "--server-url", SERVER])),
      ).toBe(true);
      expect(Exit.isSuccess(yield* h.run(["session", "list", "--server-url", SERVER]))).toBe(true);
      expect(yield* stdout).toEqual(["[]"]);
    }),
  );

  it.effect("rejects a count below one, a non-integer count, and the inspect flags (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const zero = yield* h.run(["session", "list", "--count", "0", "--server-url", SERVER]);
      expect(helpErrors(zero).join("\n")).toMatch(
        /Invalid value for flag --count: "0".*count must be at least 1/s,
      );
      const word = yield* h.run(["session", "list", "--count", "ten", "--server-url", SERVER]);
      expect(helpErrors(word).join("\n")).toMatch(/Invalid value for flag --count: "ten"/);
      const inspectFlag = yield* h.run([
        "session",
        "list",
        "--session-id",
        SESSION_ID,
        "--server-url",
        SERVER,
      ]);
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
  "--server-url",
  SERVER,
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
        "--server-url",
        SERVER,
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
        const exit = yield* h.run([
          "error-type",
          "new",
          "--key",
          key,
          "--description",
          "d",
          "--server-url",
          SERVER,
        ]);
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
      const noKey = yield* h.run([
        "error-type",
        "new",
        "--description",
        "d",
        "--server-url",
        SERVER,
      ]);
      expect(helpErrors(noKey).join("\n")).toMatch(/Missing required flag: --key/);
      const noDescription = yield* h.run([
        "error-type",
        "new",
        "--key",
        bootHang.key,
        "--server-url",
        SERVER,
      ]);
      expect(helpErrors(noDescription).join("\n")).toMatch(/Missing required flag: --description/);
      const empty = yield* h.run([
        "error-type",
        "new",
        "--key",
        bootHang.key,
        "--description",
        "",
        "--server-url",
        SERVER,
      ]);
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
      const exit = yield* h.run(["error-type", "list", "--server-url", SERVER]);
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
      const exit = yield* h.run(["error-type", "list", "--json", "--server-url", SERVER]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* lastJson).toEqual([
        { ...bootHang, createdAt: bootHang.createdAt.toISOString() },
      ]);
    }),
  );

  it.effect("prints nothing as text and [] as JSON when there are no types (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      expect(Exit.isSuccess(yield* h.run(["error-type", "list", "--server-url", SERVER]))).toBe(
        true,
      );
      expect(
        Exit.isSuccess(yield* h.run(["error-type", "list", "--json", "--server-url", SERVER])),
      ).toBe(true);
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
  "--server-url",
  SERVER,
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
  "--server-url",
  SERVER,
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
            "--server-url",
            SERVER,
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
            "--server-url",
            SERVER,
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
            "--server-url",
            SERVER,
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
        "--server-url",
        SERVER,
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
        "--server-url",
        SERVER,
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
          "--server-url",
          SERVER,
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
          "--server-url",
          SERVER,
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
          "--server-url",
          SERVER,
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
          "--server-url",
          SERVER,
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
          "--server-url",
          SERVER,
        ]);
        expect(helpErrors(emptyModel).join("\n")).toMatch(/--model.*length of at least 1/s);
        expect(h.touched).toEqual([]);
      }),
  );
});

// ---------------------------------------------------------------------------
// diagnose run
// ---------------------------------------------------------------------------

const DIAGNOSE_RUN = ["diagnose", "run", "--session-id", SESSION_ID, "--server-url", SERVER];

const DIAGNOSING_AGENT_PATH = /\/prompts\/diagnosing-agent\.html$/;

describe("diagnose run", () => {
  it.effect(
    "kicks off the reviewer with the session, the server and the diagnosis guide, and prints its link (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness({ cursor: FakeCursor.fakeCursor({ agentId: "bc-42" }) });
        h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
        const exit = yield* h.run(DIAGNOSE_RUN, WITH_CURSOR);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(h.cursor.calls).toEqual([
          {
            text: yield* rendered("diagnosing-agent.html", { SESSION_ID, SERVER_URL: SERVER }),
            model: undefined,
          },
        ]);
        const text = h.cursor.calls[0]?.text ?? "";
        expect(text).toContain(`<session_id>${SESSION_ID}</session_id>`);
        expect(text).toContain(SERVER);
        expect(text).toContain("## diagnose");
        expect(text.includes("{{")).toBe(false);
        expect(yield* stdout).toEqual([
          "Agent here, go check it out for more information: https://cursor.com/agents/bc-42",
        ]);
        expect(h.touched).toEqual(["database", "cursor"]);
      }),
  );

  it.effect("reviews a succeeded session too, and takes the server from SERVER_URL (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "succeeded", ago(500)));
      const exit = yield* h.run(["diagnose", "run", "--session-id", SESSION_ID], {
        ...WITH_CURSOR,
        SERVER_URL: SERVER,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.cursor.calls).toHaveLength(1);
      expect(h.cursor.calls[0]?.text).toContain(
        `--server-url ${SERVER} --session-id ${SESSION_ID}`,
      );
    }),
  );

  it.effect("rejects an unknown session before reading a template or spawning (unhappy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(/never/);
      const h = harness({ fs: fs.layer });
      expect(yield* h.fail(DIAGNOSE_RUN, WITH_CURSOR)).toMatchObject({
        _tag: "CommandError",
        message: `diagnose run: no session ${SESSION_ID}`,
      });
      expect(fs.reads).toEqual([]);
      expect(h.cursor.calls).toEqual([]);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("rejects a session that is still running or downloading (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(
        session(SESSION_ID, "running", ago(5)),
        session(OTHER_SESSION_ID, "downloading", ago(5)),
      );
      expect(yield* h.fail(DIAGNOSE_RUN, WITH_CURSOR)).toMatchObject({
        _tag: "CommandError",
        message: `diagnose run: session ${SESSION_ID} is still running`,
      });
      expect(
        yield* h.fail(
          ["diagnose", "run", "--session-id", OTHER_SESSION_ID, "--server-url", SERVER],
          WITH_CURSOR,
        ),
      ).toMatchObject({
        _tag: "CommandError",
        message: `diagnose run: session ${OTHER_SESSION_ID} is still downloading`,
      });
      expect(h.cursor.calls).toEqual([]);
    }),
  );

  it.effect("rejects a session that already has a diagnosis (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      h.stores.diagnosis.errorTypes.push(bootHang);
      h.stores.diagnosis.diagnoses.push(diagnosis);
      expect(yield* h.fail(DIAGNOSE_RUN, WITH_CURSOR)).toMatchObject({
        _tag: "CommandError",
        message: `diagnose run: session ${SESSION_ID} already has a diagnosis`,
      });
      expect(h.cursor.calls).toEqual([]);
    }),
  );

  it.effect(
    "fails naming the kickoff template when it is unreadable, and spawns nothing (unhappy)",
    () =>
      Effect.gen(function* () {
        const fs = promptFs(DIAGNOSING_AGENT_PATH);
        const h = harness({ fs: fs.layer });
        h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
        expect(yield* h.fail(DIAGNOSE_RUN, WITH_CURSOR)).toMatchObject({
          _tag: "PromptError",
          message: expect.stringMatching(/^prompt: .*diagnosing-agent\.html/),
        });
        expect(h.cursor.calls).toEqual([]);
        expect(yield* stdout).toEqual([]);
      }),
  );

  it.effect("requires DATABASE_URL then CURSOR_API_TOKEN, after parsing (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      expect(yield* h.fail(DIAGNOSE_RUN, {})).toMatchObject({
        _tag: "MissingVariable",
        message: "DATABASE_URL is not set",
      });
      expect(yield* h.fail(DIAGNOSE_RUN, { ...WITH_DB, CURSOR_API_TOKEN: "" })).toMatchObject({
        _tag: "MissingVariable",
        message: "CURSOR_API_TOKEN is not set",
      });
      expect(h.touched).toEqual([]);
      expect(h.cursor.calls).toEqual([]);
    }),
  );

  it.effect("requires --session-id and --server-url (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const noSession = yield* h.run(["diagnose", "run", "--server-url", SERVER], WITH_CURSOR);
      expect(helpErrors(noSession).join("\n")).toMatch(/Missing required flag: --session-id/);
      const noServer = yield* h.run(["diagnose", "run", "--session-id", SESSION_ID], WITH_CURSOR);
      expect(helpErrors(noServer).join("\n")).toMatch(/Missing required flag: --server-url/);
      expect(h.touched).toEqual([]);
    }),
  );

  it.effect("surfaces the SDK's refusal and prints nothing (unhappy)", () =>
    Effect.gen(function* () {
      const refused = Errors.CursorAgentFailed.make({
        message: "Invalid API key",
        retryable: false,
        cause: new Error("Invalid API key"),
      });
      const h = harness({ cursor: FakeCursor.fakeCursor({ failure: refused }) });
      h.stores.sessions.sessions.push(session(SESSION_ID, "failed", ago(500)));
      expect(yield* h.fail(DIAGNOSE_RUN, WITH_CURSOR)).toBe(refused);
      expect(yield* stdout).toEqual([]);
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
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--logs",
        "--server-url",
        SERVER,
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      const printed = yield* lastJson;
      expect(Array.isArray(printed)).toBe(true);
      expect(printed).toHaveLength(1);
      expect(printed[0]).toMatchObject({
        text: "starting; iso omarchy.iso",
        sessionId: SESSION_ID,
      });
      expect(h.proxy.calls).toEqual([]);
    }),
  );

  it.effect("--actions prints the bare array and --test-def the bare definition (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
      expect(
        Exit.isSuccess(
          yield* h.run([
            "session",
            "--session-id",
            SESSION_ID,
            "--actions",
            "--server-url",
            SERVER,
          ]),
        ),
      ).toBe(true);
      const actions = yield* lastJson;
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ id: 1, sessionId: SESSION_ID, state: "completed" });
      expect(
        Exit.isSuccess(
          yield* h.run([
            "session",
            "--session-id",
            SESSION_ID,
            "--test-def",
            "--server-url",
            SERVER,
          ]),
        ),
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
        "--server-url",
        SERVER,
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
        const exit = yield* h.run([
          "session",
          "--session-id",
          SESSION_ID,
          "--all",
          "--server-url",
          SERVER,
        ]);
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
        const exit = yield* h.run([
          "session",
          "--session-id",
          SESSION_ID,
          "--status",
          "--server-url",
          SERVER,
        ]);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* lastJson).toEqual({
          id: SESSION_ID,
          config: { iso: "omarchy.iso" },
          status: "succeeded",
          reason: "lock screen on screen",
          startedAt: ago(500).toISOString(),
          endedAt: ago(100).toISOString(),
        });
        expect(h.proxy.calls).toEqual([]);
      }),
  );

  it.effect(
    "--test-run prints the bare run the result belongs to, null without a result (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        seedInspect(h);
        const none = yield* h.run([
          "session",
          "--session-id",
          SESSION_ID,
          "--test-run",
          "--server-url",
          SERVER,
        ]);
        expect(Exit.isSuccess(none)).toBe(true);
        expect(yield* stdout).toEqual(["null"]);
        h.stores.tests.results.push(result(RESULT_ID, "passed", SESSION_ID));
        const some = yield* h.run([
          "session",
          "--session-id",
          SESSION_ID,
          "--test-run",
          "--server-url",
          SERVER,
        ]);
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
        const exit = yield* h.run([
          "session",
          "--session-id",
          SESSION_ID,
          "--images",
          "--server-url",
          SERVER,
        ]);
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
        const empty = yield* bare.run([
          "session",
          "--session-id",
          SESSION_ID,
          "--images",
          "--server-url",
          SERVER,
        ]);
        expect(Exit.isSuccess(empty)).toBe(true);
        expect((yield* stdout).at(-1)).toBe("[]");
      }),
  );

  it.effect("--diagnosis prints the bare diagnosis row, null when there is none (happy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const none = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--diagnosis",
        "--server-url",
        SERVER,
      ]);
      expect(Exit.isSuccess(none)).toBe(true);
      expect(yield* stdout).toEqual(["null"]);
      h.stores.diagnosis.errorTypes.push(bootHang);
      h.stores.diagnosis.diagnoses.push(diagnosis);
      const some = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--diagnosis",
        "--server-url",
        SERVER,
      ]);
      expect(Exit.isSuccess(some)).toBe(true);
      expect(yield* lastJson).toEqual({
        ...diagnosis,
        createdAt: diagnosis.createdAt.toISOString(),
      });
      expect(h.proxy.calls).toEqual([]);
    }),
  );

  it.effect("--diagnosis on an unknown session is a failure (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const error = yield* h.fail([
        "session",
        "--session-id",
        OTHER_SESSION_ID,
        "--diagnosis",
        "--server-url",
        SERVER,
      ]);
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
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--debug-logs",
        "--server-url",
        SERVER,
      ]);
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
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--debug-logs",
        "--server-url",
        SERVER,
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["null"]);
    }),
  );

  it.effect("--debug-logs on an unknown session is a failure (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run([
        "session",
        "--session-id",
        OTHER_SESSION_ID,
        "--debug-logs",
        "--server-url",
        SERVER,
      ]);
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
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--test-results",
        "--server-url",
        SERVER,
      ]);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(yield* stdout).toEqual(["null"]);
    }),
  );

  it.effect("requires a selector (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--server-url", SERVER]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message:
          "session: --status, --logs, --test-def, --test-results, --test-run, --actions, --images, --debug-logs, --diagnosis, --all, or --dump is required",
      });
    }),
  );

  it.effect("--dump does not combine with the JSON selectors (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      seedInspect(h);
      for (const selector of ["--status", "--logs", "--images", "--diagnosis", "--all"]) {
        const exit = yield* h.run(
          ["session", "--session-id", SESSION_ID, "--dump", selector, "--server-url", SERVER],
          {
            ...WITH_DB,
            OLIGARCHY_TOKEN: "t",
          },
        );
        expect(failure(exit)).toMatchObject({
          message:
            "session: --dump does not combine with --status, --logs, --test-def, --test-results, --test-run, --actions, --images, --debug-logs, --diagnosis, or --all",
        });
      }
      expect(h.proxy.calls).toEqual([]);
      expect(yield* stdout).toEqual([]);
    }),
  );

  it.effect("rejects an unknown session (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--logs",
        "--server-url",
        SERVER,
      ]);
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
      const exit = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--test-results",
        "--server-url",
        SERVER,
      ]);
      expect(failure(exit)).toMatchObject({
        message: `session: multiple test results for ${SESSION_ID}`,
      });
    }),
  );

  it.effect("rejects --active and --count on inspection (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      const active = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--logs",
        "--active",
        "--server-url",
        SERVER,
      ]);
      expect(helpErrors(active).join("\n")).toMatch(/Unrecognized flag: --active/);
      const count = yield* h.run([
        "session",
        "--session-id",
        SESSION_ID,
        "--logs",
        "--count",
        "3",
        "--server-url",
        SERVER,
      ]);
      expect(helpErrors(count).join("\n")).toMatch(/Unrecognized flag: --count/);
      expect(h.touched).toEqual([]);
    }),
  );
});

// ---------------------------------------------------------------------------
// session --dump
// ---------------------------------------------------------------------------

describe("session --dump", () => {
  const bytes = new Uint8Array([0x5b, 0x20, 0x30, 0x5d, 0xff, 0x0a]);

  it.effect(
    "sends the database's canonical id with the token and writes the bytes raw (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness({ proxy: fakeProxy({ bytes }) });
        seedInspect(h);
        const exit = yield* h.run(
          ["session", "--session-id", SESSION_ID.toUpperCase(), "--dump", "--server-url", SERVER],
          { ...WITH_DB, OLIGARCHY_TOKEN: "test-token" },
        );
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(h.proxy.calls).toEqual([{ serverUrl: SERVER, token: "test-token", id: SESSION_ID }]);
        expect(h.stdio.stdout.map((chunk) => [...chunk])).toEqual([[...bytes]]);
        expect(yield* stdout).toEqual([]);
      }),
  );

  it.effect("prints an empty console as nothing and takes the proxy from SERVER_URL (happy)", () =>
    Effect.gen(function* () {
      const h = harness({ proxy: fakeProxy({ bytes: new Uint8Array() }) });
      seedInspect(h);
      const exit = yield* h.run(["session", "--session-id", SESSION_ID, "--dump"], {
        ...WITH_DB,
        OLIGARCHY_TOKEN: "test-token",
        SERVER_URL: "http://127.0.0.1:1",
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(h.proxy.calls).toEqual([
        { serverUrl: "http://127.0.0.1:1", token: "test-token", id: SESSION_ID },
      ]);
      expect(StdioSupport.text(h.stdio.stdout)).toBe("");
    }),
  );

  it.effect(
    "requires OLIGARCHY_TOKEN before calling the proxy; the JSON selectors never need it (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = harness({ proxy: fakeProxy({ bytes }) });
        seedInspect(h);
        const dump = yield* h.run(
          ["session", "--session-id", SESSION_ID, "--dump", "--server-url", SERVER],
          {
            ...WITH_DB,
            OLIGARCHY_TOKEN: "",
          },
        );
        expect(failure(dump)).toMatchObject({
          _tag: "MissingVariable",
          message: "OLIGARCHY_TOKEN is not set",
        });
        expect(h.proxy.calls).toEqual([]);
        expect(h.stdio.stdout).toEqual([]);
        const logs = yield* h.run(
          ["session", "--session-id", SESSION_ID, "--logs", "--server-url", SERVER],
          {
            ...WITH_DB,
            OLIGARCHY_TOKEN: "",
          },
        );
        expect(Exit.isSuccess(logs)).toBe(true);
        expect(Array.isArray(yield* lastJson)).toBe(true);
      }),
  );

  it.effect("rejects an unknown session before calling the proxy (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness({ proxy: fakeProxy({ bytes }) });
      const exit = yield* h.run(
        ["session", "--session-id", SESSION_ID, "--dump", "--server-url", SERVER],
        {
          ...WITH_DB,
          OLIGARCHY_TOKEN: "test-token",
        },
      );
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: `session: no session ${SESSION_ID}`,
      });
      expect(h.proxy.calls).toEqual([]);
    }),
  );

  it.effect("surfaces the proxy's refusal as its message (unhappy)", () =>
    Effect.gen(function* () {
      const refused = Errors.ProxyRefusal.make({
        status: 409,
        message: `session "${SESSION_ID}" has no console on this proxy`,
      });
      const h = harness({ proxy: fakeProxy({ failure: refused }) });
      seedInspect(h);
      const exit = yield* h.run(
        ["session", "--session-id", SESSION_ID, "--dump", "--server-url", SERVER],
        {
          ...WITH_DB,
          OLIGARCHY_TOKEN: "test-token",
        },
      );
      expect(failure(exit)).toBe(refused);
      expect(h.proxy.calls).toHaveLength(1);
      expect(h.stdio.stdout).toEqual([]);
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
          ["test", "--list", "--server-url", SERVER],
          ["test", "list", "--server-url", SERVER],
          ["test", "run", "--ticket", "OLI-42"],
          [
            "test",
            "start",
            "--session-id",
            SESSION_ID,
            "--test-result-id",
            RESULT_ID,
            "--model",
            MODEL,
            "--server-url",
            SERVER,
          ],
          [
            "test-results",
            "--agent-id",
            "a",
            "--id",
            RESULT_ID,
            "--status",
            "success",
            "--server-url",
            SERVER,
          ],
          ["session", "list", "--server-url", SERVER],
          ["session", "--session-id", SESSION_ID, "--logs", "--server-url", SERVER],
          NEW_TYPE,
          ["error-type", "list", "--server-url", SERVER],
          DIAGNOSE,
          DIAGNOSE_RUN,
        ]) {
          const exit = yield* h.run(args, {
            DATABASE_URL: "",
            LINEAR_API_TOKEN: "l",
            CURSOR_API_TOKEN: "c",
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

describe("--server-url", () => {
  const withoutServer: ReadonlyArray<ReadonlyArray<string>> = [
    ["test", "--list"],
    NEW,
    ["test", "list"],
    ["test", "start", "--session-id", SESSION_ID, "--test-result-id", RESULT_ID, "--model", MODEL],
    ["test-results", "--agent-id", "a", "--id", RESULT_ID, "--status", "success"],
    ["session", "list"],
    ["session", "--session-id", SESSION_ID, "--logs"],
    NEW_TYPE.slice(0, -2),
    ["error-type", "list"],
    DIAGNOSE.slice(0, -2),
    DIAGNOSE_RUN.slice(0, -2),
  ];

  it.effect("is required on every action but test run (unhappy)", () =>
    Effect.gen(function* () {
      const h = harness();
      for (const args of withoutServer) {
        const exit = yield* h.run(args, { ...WITH_LINEAR, CURSOR_API_TOKEN: "c" });
        expect(helpErrors(exit).join("\n")).toMatch(/Missing required flag: --server-url/);
      }
      expect(h.touched).toEqual([]);
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

describe("--help", () => {
  it.effect(
    "on the root, test, session and every subcommand touches nothing and exits 0 (happy)",
    () =>
      Effect.gen(function* () {
        const h = harness();
        for (const args of [
          ["--help"],
          ["test", "--help"],
          ["test", "new", "--help"],
          ["test", "list", "--help"],
          ["test", "run", "--help"],
          ["test", "start", "--help"],
          ["test-results", "--help"],
          ["session", "--help"],
          ["session", "list", "--help"],
          ["error-type", "--help"],
          ["error-type", "new", "--help"],
          ["error-type", "list", "--help"],
          ["diagnose", "--help"],
          ["diagnose", "run", "--help"],
        ]) {
          // The built-in --help renders and succeeds; runMain exits 0.
          const exit = yield* h.run(args, {});
          expect(Exit.isSuccess(exit)).toBe(true);
        }
        expect(h.touched).toEqual([]);
        expect(h.proxy.calls).toEqual([]);
        const printed = (yield* stdout).join("\n");
        expect(printed).toMatch(/test-results/);
        expect(printed).toMatch(/session/);
        expect(printed).toMatch(/error-type/);
        expect(printed).toMatch(/diagnose/);
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
