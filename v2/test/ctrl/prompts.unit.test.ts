import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Result } from "effect";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as FakeFs from "../support/fake-fs.ts";

const SERVER = "https://qemu.example.com";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const experiment = {
  id: "11111111-1111-4111-8111-111111111111",
  iso: "https://example.com/omarchy.iso",
  serverUrl: SERVER,
  version: "1.2.3",
  tests: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      definitionId: 1,
      name: "Install Omarchy",
      description: "Install the operating system",
      instruction: "Complete the installer",
      proof: "The desktop is visible",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      definitionId: 2,
      name: "Open a terminal",
      description: "Verify the terminal starts",
      instruction: "Launch the terminal",
      proof: "A terminal window is visible",
    },
  ],
} satisfies Prompts.Experiment;

const firstTest = experiment.tests[0];
const secondTest = experiment.tests[1];

const issuePrompts = Prompts.loadIssuePrompts.pipe(Effect.provide(NodeFileSystem.layer));

const drivingPrompt = Prompts.loadDrivingPrompt.pipe(Effect.provide(NodeFileSystem.layer));

const diagnosisPrompts = Prompts.loadDiagnosisPrompts.pipe(Effect.provide(NodeFileSystem.layer));

// A FileSystem over the prompt files whose reads matching `unreadable` fail, recording the
// path of every read so a test can say which files a loader touched.
const promptFs = (
  unreadable: RegExp,
): { readonly reads: Array<string>; readonly layer: Layer.Layer<FileSystem.FileSystem> } => {
  const reads: Array<string> = [];
  const layer = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        reads.push(path);
        return unreadable.test(path)
          ? Effect.fail(FakeFs.permissionDenied("open", path))
          : Effect.succeed(`contents of ${path}`);
      }),
  });
  return { reads, layer };
};

const fileNames = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths.map((path) => path.slice(path.lastIndexOf("/") + 1));

const failureOf = <A>(rendered: Result.Result<A, { readonly message: string }>): string => {
  if (Result.isSuccess(rendered)) {
    throw new Error("expected the rendering to fail");
  }
  return rendered.failure.message;
};

describe("render", () => {
  it("fills every placeholder, repeated ones included (happy)", () => {
    const rendered = Prompts.render("a {{ONE}} b {{TWO}} {{ONE}}", "x.html", {
      ONE: "1",
      TWO: "2",
    });
    expect(Result.isSuccess(rendered)).toBe(true);
    expect(Result.getOrThrow(rendered)).toBe("a 1 b 2 1");
  });

  it("leaves text without placeholders alone and ignores unused values (happy)", () => {
    const rendered = Prompts.render("plain {not a placeholder} {{lower}}", "x.html", {
      UNUSED: "u",
    });
    expect(Result.getOrThrow(rendered)).toBe("plain {not a placeholder} {{lower}}");
  });

  it("fails as a PromptError naming the file and the first placeholder without a value (unhappy)", () => {
    const rendered = Prompts.render("a {{MISSING}} {{ALSO}}", "linear-issue.html", { ONE: "1" });
    expect(Result.isFailure(rendered)).toBe(true);
    if (Result.isFailure(rendered)) {
      expect(rendered.failure._tag).toBe("PromptError");
      expect(rendered.failure.message).toBe(
        "prompt: prompts/linear-issue.html uses {{MISSING}}, which has no value",
      );
    }
  });
});

describe("loadDrivingPrompt", () => {
  it.effect("reads prompts/driving-agent.html and nothing else (happy)", () =>
    Effect.gen(function* () {
      // Every other prompt file is unreadable: the kickoff must not need them.
      const fs = promptFs(
        /\/(client\.md|ctrl-[a-z]+\.md|linear-issue\.html|diagnosing-agent\.html)$/,
      );
      const template = yield* Prompts.loadDrivingPrompt.pipe(Effect.provide(fs.layer));
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
      expect(template).toMatch(/^contents of .*\/prompts\/driving-agent\.html$/);
    }),
  );

  it.effect("fails as a PromptError naming the template when it is unreadable (unhappy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(/driving-agent\.html$/);
      const error = yield* Effect.flip(Prompts.loadDrivingPrompt.pipe(Effect.provide(fs.layer)));
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*driving-agent\.html/);
      expect(error.cause).toBeDefined();
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
    }),
  );
});

describe("loadIssuePrompts", () => {
  it.effect("reads the ticket template and both guides, not the kickoff templates (happy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(/-agent\.html$|ctrl-diagnose\.md$/);
      const loaded = yield* Prompts.loadIssuePrompts.pipe(Effect.provide(fs.layer));
      expect([...fileNames(fs.reads)].sort()).toEqual([
        "client.md",
        "ctrl-linear.md",
        "linear-issue.html",
      ]);
      expect(loaded.linearIssue).toMatch(/\/prompts\/linear-issue\.html$/);
      expect(loaded.clientMd).toMatch(/\/client\.md$/);
      expect(loaded.ctrlMd).toMatch(/\/ctrl-linear\.md$/);
    }),
  );

  it.effect("fails as a PromptError naming an unreadable guide (unhappy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(/\/client\.md$/);
      const error = yield* Effect.flip(Prompts.loadIssuePrompts.pipe(Effect.provide(fs.layer)));
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*client\.md/);
    }),
  );
});

describe("loadDiagnosisPrompts", () => {
  it.effect("reads the diagnosing template and its guide, nothing of the drive (happy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(/\/(client\.md|ctrl-linear\.md|linear-issue\.html|driving-agent\.html)$/);
      const loaded = yield* Prompts.loadDiagnosisPrompts.pipe(Effect.provide(fs.layer));
      expect([...fileNames(fs.reads)].sort()).toEqual([
        "ctrl-diagnose.md",
        "diagnosing-agent.html",
      ]);
      expect(loaded.diagnosingAgent).toMatch(/\/prompts\/diagnosing-agent\.html$/);
      expect(loaded.ctrlMd).toMatch(/\/ctrl-diagnose\.md$/);
    }),
  );

  it.effect("fails as a PromptError naming the unreadable file (unhappy)", () =>
    Effect.gen(function* () {
      const fs = promptFs(/ctrl-diagnose\.md$/);
      const error = yield* Effect.flip(Prompts.loadDiagnosisPrompts.pipe(Effect.provide(fs.layer)));
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*ctrl-diagnose\.md/);
      expect(error.cause).toBeDefined();
    }),
  );
});

describe("linearTicketDescription", () => {
  it.effect(
    "renders the ticket, run, result, ISO, server, both guides, and this definition only (happy)",
    () =>
      Effect.gen(function* () {
        const loaded = yield* issuePrompts;
        const description = Result.getOrThrow(
          Prompts.linearTicketDescription(experiment, firstTest, "OLI-42", loaded),
        );

        expect(description.includes("{{")).toBe(false);
        expect(description).toContain("<agent_id>OLI-42</agent_id>");
        expect(description).toContain(
          `start --agent-id OLI-42 --server-url ${experiment.serverUrl} --iso ${experiment.iso}`,
        );
        expect(description).toContain(
          `./ctrl test start --server-url ${experiment.serverUrl} --session-id`,
        );
        expect(description).toContain("--model <the Cursor model id you are running as>");
        expect(description).not.toContain("--model grok-4.6");
        expect(description).toContain(
          `./ctrl test-results --agent-id OLI-42 --server-url ${experiment.serverUrl} --id ${firstTest.id}`,
        );
        expect(description).toContain(
          `./client get-image --agent-id OLI-42 --server-url ${experiment.serverUrl} --session-id`,
        );
        expect(description).toContain(
          `./client stop --agent-id OLI-42 --server-url ${experiment.serverUrl} --session-id`,
        );
        expect(description).not.toMatch(
          /(get-image|get-serial|send-keys|send-mouse|stop) (--agent-id <agent> --server-url <url> )?<id>/,
        );
        expect(description).toContain(`<run_id>${experiment.id}</run_id>`);
        expect(description).toContain(`<result_id>${firstTest.id}</result_id>`);
        expect(description).toContain(`<version>${experiment.version}</version>`);
        expect(description).toContain(`<name>${firstTest.name}</name>`);
        expect(description).toContain(`<description>${firstTest.description}</description>`);
        expect(description).toContain(`<instruction>${firstTest.instruction}</instruction>`);
        expect(description).toContain(`<proof>${firstTest.proof}</proof>`);
        expect(description).toContain("# Client\n");
        expect(description).toContain("## The loop");
        expect(description).toContain("# Control\n");
        expect(description).toContain("## test start");
        expect(description).toContain("## test-results");
        expect(description).not.toContain("## diagnose");
        expect(description).toContain(Prompts.SUB_AGENT);
        expect(description.includes("--session_id")).toBe(false);
        expect(description.includes("--server_url")).toBe(false);
        expect(description.includes(secondTest.name)).toBe(false);
        expect(description.includes(secondTest.id)).toBe(false);
      }),
  );

  it("fails when the template names a value the experiment does not carry (unhappy)", () => {
    const rendered = Prompts.linearTicketDescription(experiment, firstTest, "OLI-42", {
      linearIssue: "{{RUN_ID}} {{NOPE}}",
      clientMd: "",
      ctrlMd: "",
    });
    expect(failureOf(rendered)).toBe(
      "prompt: prompts/linear-issue.html uses {{NOPE}}, which has no value",
    );
  });
});

describe("drivingAgentPrompt", () => {
  it.effect(
    "renders the kickoff prompt from the ticket alone; the server url is in the ticket (happy)",
    () =>
      Effect.gen(function* () {
        const template = yield* drivingPrompt;
        const text = Result.getOrThrow(Prompts.drivingAgentPrompt("OLI-42", template));
        expect(text.includes("{{")).toBe(false);
        // The formatter wrapped the template between "ticket" and the placeholder.
        expect(text).toMatch(/Review Linear ticket\s+OLI-42/);
        expect(text).toContain("<agent-id> OLI-42 </agent-id>");
        expect(text).toContain("./client");
        expect(text.includes("--server-url")).toBe(false);
        expect(text.includes("http")).toBe(false);
      }),
  );

  it("fails on a template asking for more than the ticket (unhappy)", () => {
    const rendered = Prompts.drivingAgentPrompt("OLI-42", "{{LINEAR_TICKET}} {{SERVER_URL}}");
    expect(failureOf(rendered)).toBe(
      "prompt: prompts/driving-agent.html uses {{SERVER_URL}}, which has no value",
    );
  });
});

describe("diagnosingAgentPrompt", () => {
  it.effect(
    "renders the session, the server and the diagnosis guide; nothing of the drive (happy)",
    () =>
      Effect.gen(function* () {
        const loaded = yield* diagnosisPrompts;
        const text = Result.getOrThrow(Prompts.diagnosingAgentPrompt(SESSION_ID, SERVER, loaded));

        expect(text.includes("{{")).toBe(false);
        expect(text).toContain(`<session_id>${SESSION_ID}</session_id>`);
        expect(text).toContain(`<server_url>\`${SERVER}\`</server_url>`);
        expect(text).toContain(
          `./ctrl session --server-url ${SERVER} --session-id ${SESSION_ID} --all`,
        );
        expect(text).toContain(`./ctrl diagnose --server-url ${SERVER} --session-id ${SESSION_ID}`);
        expect(text).toContain("--model <the Cursor model id you are running as>");
        expect(text).toContain("# Control\n");
        expect(text).toContain("## session");
        expect(text).toContain("## error-type list");
        expect(text).toContain("## error-type new");
        expect(text).toContain("## diagnose");
        expect(text).toContain("--verdict passed|failed");
        expect(text).toContain("--images");
        // The reviewer drives nothing: no client guide, no ticket, no result id.
        expect(text).not.toContain("./client");
        expect(text).not.toContain("## test start");
        expect(text).not.toContain("LINEAR_TICKET");
        expect(text).not.toContain("--test-result-id");
      }),
  );

  it("fails on a template asking for more than the session and the server (unhappy)", () => {
    const rendered = Prompts.diagnosingAgentPrompt(SESSION_ID, SERVER, {
      diagnosingAgent: "{{SESSION_ID}} {{SERVER_URL}} {{CTRL_MD}} {{RESULT_ID}}",
      ctrlMd: "",
    });
    expect(failureOf(rendered)).toBe(
      "prompt: prompts/diagnosing-agent.html uses {{RESULT_ID}}, which has no value",
    );
  });
});
