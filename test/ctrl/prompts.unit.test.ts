import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as FakeFs from "../support/fake-fs.ts";

const SERVER = "https://qemu.example.com";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

// Every value a ticket asks for.
const ticket = {
  LINEAR_TICKET: "OLI-42",
  RUN_ID: "11111111-1111-4111-8111-111111111111",
  RESULT_ID: "22222222-2222-4222-8222-222222222222",
  VERSION: "1.2.3",
  ISO_URL: "https://example.com/omarchy.iso",
  SERVER_URL: SERVER,
  TEST_NAME: "Install Omarchy",
  TEST_DESCRIPTION: "Install the operating system",
  TEST_INSTRUCTION: "Complete the installer",
  TEST_PROOF: "The desktop is visible",
} satisfies Prompts.Values;

const real = <A, E>(self: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  self.pipe(Effect.provide(NodeFileSystem.layer));

// A FileSystem over the prompt files: each path answers with the text scripted for its file name
// (`contents of <name>` when none is), or fails as an unreadable file would when `unreadable`
// matches it. Every read is recorded so a test can say which files a rendering touched.
const promptFs = (
  options: {
    readonly unreadable?: RegExp;
    readonly contents?: Readonly<Record<string, string>>;
  } = {},
): { readonly reads: Array<string>; readonly layer: Layer.Layer<FileSystem.FileSystem> } => {
  const reads: Array<string> = [];
  const layer = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        reads.push(path);
        const name = path.slice(path.lastIndexOf("/") + 1);
        return options.unreadable?.test(path) === true
          ? Effect.fail(FakeFs.permissionDenied("open", path))
          : Effect.succeed(options.contents?.[name] ?? `contents of ${name}`);
      }),
  });
  return { reads, layer };
};

const fileNames = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths.map((path) => path.slice(path.lastIndexOf("/") + 1));

describe("render happy path", () => {
  it.effect("fills a template from the values, the constants, and the guides it names", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: {
          "diagnosing-agent.html":
            "{{SESSION_ID}} at {{SERVER_URL}}, again {{SESSION_ID}}; by {{SUB_AGENT}}\n<guide>\n{{CTRL_DIAGNOSE_MD}}\n</guide>",
          "ctrl-diagnose.md": "# Control\n\nRead the session.\n",
        },
      });
      const text = yield* Prompts.render("diagnosing-agent.html", {
        SESSION_ID,
        SERVER_URL: SERVER,
      }).pipe(Effect.provide(fs.layer));
      // The guide's trailing newline is trimmed so the closing tag sits under its last line.
      expect(text).toBe(
        `${SESSION_ID} at ${SERVER}, again ${SESSION_ID}; by ${Prompts.SUB_AGENT}\n<guide>\n# Control\n\nRead the session.\n</guide>`,
      );
      // The template, then the one guide it names; client.md and ctrl-linear.md are never read.
      expect(fileNames(fs.reads)).toEqual(["diagnosing-agent.html", "ctrl-diagnose.md"]);
    }),
  );

  it.effect(
    "reads nothing but the template when it names no guide, and ignores unused values",
    () =>
      Effect.gen(function* () {
        const fs = promptFs({
          unreadable: /\.md$/,
          contents: {
            "driving-agent.html": "ticket {{LINEAR_TICKET}} {not a placeholder} {{lower}}",
          },
        });
        const text = yield* Prompts.render("driving-agent.html", {
          ...ticket,
          SESSION_ID,
        }).pipe(Effect.provide(fs.layer));
        expect(text).toBe("ticket OLI-42 {not a placeholder} {{lower}}");
        expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
      }),
  );

  it.effect(
    "linear-issue.html: the ticket, run, result, ISO, server, both guides, this test only",
    () =>
      Effect.gen(function* () {
        const description = yield* real(Prompts.render("linear-issue.html", ticket));

        expect(description.includes("{{")).toBe(false);
        expect(description).toContain("<agent_id>OLI-42</agent_id>");
        expect(description).toContain(
          `start --agent-id OLI-42 --server-url ${SERVER} --iso ${ticket.ISO_URL}`,
        );
        // ./ctrl reads the database; the proxy url is ./client's alone.
        expect(description).toContain("./ctrl test start --session-id");
        expect(description).toContain("--model <the Cursor model id you are running as>");
        expect(description).not.toContain("--model grok-4.6");
        expect(description).toContain(
          `./ctrl test-results --agent-id OLI-42 --id ${ticket.RESULT_ID}`,
        );
        expect(description).not.toMatch(/\.\/ctrl [^\n]*--server-url/);
        expect(description).toContain(
          `./client get-image --agent-id OLI-42 --server-url ${SERVER} --session-id`,
        );
        expect(description).toContain(
          `./client stop --agent-id OLI-42 --server-url ${SERVER} --session-id`,
        );
        expect(description).not.toMatch(
          /(get-image|get-serial|send-keys|send-mouse|stop) (--agent-id <agent> --server-url <url> )?<id>/,
        );
        expect(description).toContain(`<run_id>${ticket.RUN_ID}</run_id>`);
        expect(description).toContain(`<result_id>${ticket.RESULT_ID}</result_id>`);
        expect(description).toContain(`<version>${ticket.VERSION}</version>`);
        expect(description).toContain(`<name>${ticket.TEST_NAME}</name>`);
        expect(description).toContain(`<description>${ticket.TEST_DESCRIPTION}</description>`);
        expect(description).toContain(`<instruction>${ticket.TEST_INSTRUCTION}</instruction>`);
        expect(description).toContain(`<proof>${ticket.TEST_PROOF}</proof>`);
        expect(description).toContain("# Client\n");
        expect(description).toContain("## The loop");
        expect(description).toContain("# Control\n");
        expect(description).toContain("## test start");
        expect(description).toContain("## test-results");
        expect(description).not.toContain("## diagnose");
        expect(description).toContain(Prompts.SUB_AGENT);
        expect(description.includes("--session_id")).toBe(false);
        expect(description.includes("--server_url")).toBe(false);
      }),
  );

  it.effect("driving-agent.html: the ticket and the model; the server url is in the ticket", () =>
    Effect.gen(function* () {
      const text = yield* real(
        Prompts.render("driving-agent.html", {
          LINEAR_TICKET: "OLI-42",
          MODEL: "gpt-5.6-luna-none-fast",
        }),
      );
      expect(text.includes("{{")).toBe(false);
      // The formatter wrapped the template between "ticket" and the placeholder.
      expect(text).toMatch(/Review Linear ticket\s+OLI-42/);
      expect(text).toContain("<agent-id> OLI-42 </agent-id>");
      // The driver is told its model once and told what to do with it: test start records it.
      expect(text).toContain("<model> gpt-5.6-luna-none-fast </model>");
      expect(text).toContain("--model gpt-5.6-luna-none-fast");
      expect(text).toContain("./client");
      expect(text.includes("--server-url")).toBe(false);
      expect(text.includes("http")).toBe(false);
    }),
  );

  it.effect(
    "diagnosing-agent.html: the session and the diagnosis guide; no proxy, nothing of the drive",
    () =>
      Effect.gen(function* () {
        const text = yield* real(Prompts.render("diagnosing-agent.html", { SESSION_ID }));

        expect(text.includes("{{")).toBe(false);
        expect(text).toContain(`<session_id>${SESSION_ID}</session_id>`);
        expect(text).toContain(`./ctrl session --session-id ${SESSION_ID} --all`);
        expect(text).toContain(`./ctrl diagnose --session-id ${SESSION_ID}`);
        expect(text).toContain("--model <the Cursor model id you are running as>");
        // The reviewer reads the database alone: no server url, no token, reaches it.
        expect(text.includes("server_url")).toBe(false);
        expect(text.includes("--server-url")).toBe(false);
        expect(text.includes("SERVER_URL")).toBe(false);
        expect(text.includes("OLIGARCHY_TOKEN")).toBe(false);
        expect(text).toContain("# Control\n");
        expect(text).toContain("## session");
        expect(text).toContain("## error-type list");
        expect(text).toContain("## error-type new");
        expect(text).toContain("## diagnose");
        expect(text).toContain("--verdict passed|failed");
        expect(text).toContain("--images");
        // The screenshots are evidence the reviewer looks at, through the database.
        expect(text).toContain("./session image --image-id");
        // The reviewer drives nothing: no client guide, no ticket, no result id.
        expect(text).not.toContain("./client");
        expect(text).not.toContain("## test start");
        expect(text).not.toContain("LINEAR_TICKET");
        expect(text).not.toContain("--test-result-id");
      }),
  );
});

describe("render unhappy path", () => {
  it.effect(
    "a template asking for a ticket nobody has is refused, naming the template and the name",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(real(Prompts.render("driving-agent.html", {})));
        expect(error._tag).toBe("PromptError");
        expect(error.message).toBe(
          "prompt: prompts/driving-agent.html uses {{LINEAR_TICKET}}, which has no value",
        );
        // A driver kicked off without a model would have nothing to record at test start.
        const withoutModel = yield* Effect.flip(
          real(Prompts.render("driving-agent.html", { LINEAR_TICKET: "OLI-42" })),
        );
        expect(withoutModel.message).toBe(
          "prompt: prompts/driving-agent.html uses {{MODEL}}, which has no value",
        );
        const withoutTicket = yield* Effect.flip(
          real(Prompts.render("linear-issue.html", { SESSION_ID, SERVER_URL: SERVER })),
        );
        expect(withoutTicket.message).toBe(
          "prompt: prompts/linear-issue.html uses {{LINEAR_TICKET}}, which has no value",
        );
      }),
  );

  it.effect("the first placeholder without a value is the one named, guides included", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: { "linear-issue.html": "{{RUN_ID}} {{NOPE}} {{ALSO}} {{CLIENT_MD}}" },
      });
      const error = yield* Effect.flip(
        Prompts.render("linear-issue.html", ticket).pipe(Effect.provide(fs.layer)),
      );
      expect(error).toMatchObject({
        _tag: "PromptError",
        message: "prompt: prompts/linear-issue.html uses {{NOPE}}, which has no value",
      });
      expect(error.cause).toBeUndefined();
    }),
  );

  it.effect("an unreadable template is a PromptError naming it, before any guide is read", () =>
    Effect.gen(function* () {
      const fs = promptFs({ unreadable: /linear-issue\.html$/ });
      const error = yield* Effect.flip(
        Prompts.render("linear-issue.html", ticket).pipe(Effect.provide(fs.layer)),
      );
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*linear-issue\.html/);
      expect(error.cause).toBeDefined();
      expect(fileNames(fs.reads)).toEqual(["linear-issue.html"]);
    }),
  );

  it.effect("an unreadable guide the template names is a PromptError naming the guide", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        unreadable: /ctrl-linear\.md$/,
        contents: { "linear-issue.html": "{{CLIENT_MD}} {{CTRL_MD}} {{LINEAR_TICKET}}" },
      });
      const error = yield* Effect.flip(
        Prompts.render("linear-issue.html", ticket).pipe(Effect.provide(fs.layer)),
      );
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*ctrl-linear\.md/);
      expect(error.cause).toBeDefined();
      expect(fileNames(fs.reads)).toEqual(["linear-issue.html", "client.md", "ctrl-linear.md"]);
    }),
  );

  it.effect("an unreadable guide the template does not name cannot stop a rendering", () =>
    Effect.gen(function* () {
      const fs = promptFs({ unreadable: /\/(client\.md|ctrl-linear\.md)$/ });
      const text = yield* Prompts.render("diagnosing-agent.html", { SESSION_ID }).pipe(
        Effect.provide(fs.layer),
      );
      expect(text).toBe("contents of diagnosing-agent.html");
      expect(fileNames(fs.reads)).toEqual(["diagnosing-agent.html"]);
    }),
  );
});
