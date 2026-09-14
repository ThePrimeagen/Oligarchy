import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as FakeFs from "../support/fake-fs.ts";

const SERVER = "https://qemu.example.com";
const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

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

describe("renderLinearIssue happy path", () => {
  it.effect("fills the ticket from the values, the constants, and the guides it names", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: {
          "linear-issue.html":
            "{{LINEAR_TICKET}} at {{SERVER_URL}}, again {{LINEAR_TICKET}}; by {{SUB_AGENT}}\n<guide>\n{{CTRL_MD}}\n</guide>",
          "ctrl-linear.md": "# Control\n\nRead the session.\n",
        },
      });
      const text = yield* Prompts.renderLinearIssue(ticket).pipe(Effect.provide(fs.layer));
      // The guide's trailing newline is trimmed so the closing tag sits under its last line.
      expect(text).toBe(
        `OLI-42 at ${SERVER}, again OLI-42; by ${SUB_AGENT}\n<guide>\n# Control\n\nRead the session.\n</guide>`,
      );
      // The template, then the one guide it names; client.md is never read.
      expect(fileNames(fs.reads)).toEqual(["linear-issue.html", "ctrl-linear.md"]);
    }),
  );

  it.effect(
    "reads nothing but the template when it names no guide, and ignores unused values",
    () =>
      Effect.gen(function* () {
        const fs = promptFs({
          unreadable: /\.md$/,
          contents: {
            "linear-issue.html": "ticket {{LINEAR_TICKET}} {not a placeholder} {{lower}}",
          },
        });
        const text = yield* Prompts.renderLinearIssue(ticket).pipe(Effect.provide(fs.layer));
        expect(text).toBe("ticket OLI-42 {not a placeholder} {{lower}}");
        expect(fileNames(fs.reads)).toEqual(["linear-issue.html"]);
      }),
  );

  it.effect(
    "linear-issue.html: the ticket, run, result, ISO, server, both guides, this test only",
    () =>
      Effect.gen(function* () {
        const description = yield* real(Prompts.renderLinearIssue(ticket));

        expect(description.includes("{{")).toBe(false);
        expect(description).toContain("<agent_id>OLI-42</agent_id>");
        expect(description).toContain(
          `start --agent-id OLI-42 --server-url ${SERVER} --iso ${ticket.ISO_URL}`,
        );
        // ./ctrl reads the database; the qemu server url is ./client's alone.
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
        expect(description).toContain(SUB_AGENT);
        expect(description.includes("--session_id")).toBe(false);
        expect(description.includes("--server_url")).toBe(false);
      }),
  );
});

describe("renderLinearIssue unhappy path", () => {
  it.effect("the first placeholder without a value is the one named, guides included", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: { "linear-issue.html": "{{RUN_ID}} {{NOPE}} {{ALSO}} {{CLIENT_MD}}" },
      });
      const error = yield* Effect.flip(
        Prompts.renderLinearIssue(ticket).pipe(Effect.provide(fs.layer)),
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
        Prompts.renderLinearIssue(ticket).pipe(Effect.provide(fs.layer)),
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
        Prompts.renderLinearIssue(ticket).pipe(Effect.provide(fs.layer)),
      );
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*ctrl-linear\.md/);
      expect(error.cause).toBeDefined();
      expect(fileNames(fs.reads)).toEqual(["linear-issue.html", "client.md", "ctrl-linear.md"]);
    }),
  );

  it.effect("an unreadable guide the template does not name cannot stop a rendering", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        unreadable: /\/(client\.md|ctrl-linear\.md)$/,
        contents: { "linear-issue.html": "ticket {{LINEAR_TICKET}}" },
      });
      const text = yield* Prompts.renderLinearIssue(ticket).pipe(Effect.provide(fs.layer));
      expect(text).toBe("ticket OLI-42");
      expect(fileNames(fs.reads)).toEqual(["linear-issue.html"]);
    }),
  );
});

// Every value a mint ticket asks for: the run's ids, the install's wording, and the one qemu
// server it is pinned to. No version: a mint is not a test of one.
const mint = {
  LINEAR_TICKET: "OLI-42",
  RUN_ID: "11111111-1111-4111-8111-111111111111",
  RESULT_ID: "22222222-2222-4222-8222-222222222222",
  ISO_URL: "https://example.com/omarchy.iso",
  SERVER_URL: SERVER,
  PINNED_SERVER: "http://127.0.0.1:55331",
  INSTALL_NAME: "mint",
  INSTALL_DESCRIPTION: "Install Omarchy and keep the disk",
  INSTALL_INSTRUCTION: "User oligarchy, password oligarchy, disk passphrase oligarchy",
  INSTALL_PROOF: "The desktop is on screen after the reboot",
} satisfies Prompts.MintValues;

// The template's own words: everything before the first embedded guide.
const ownWords = (description: string): string =>
  description.slice(0, description.indexOf("<client>"));

// The worked example at the end, after both guides.
const exampleOf = (description: string): string =>
  description.slice(description.indexOf("<example-session>"));

describe("renderMintIssue happy path", () => {
  it.effect("mint-issue.html is its own ticket: the values, both guides, no test wording", () =>
    Effect.gen(function* () {
      const description = yield* real(Prompts.renderMintIssue(mint));
      const own = ownWords(description);

      expect(description.includes("{{")).toBe(false);
      expect(own).toContain(`<linear_ticket>${mint.LINEAR_TICKET}</linear_ticket>`);
      expect(own).toContain(`<run_id>${mint.RUN_ID}</run_id>`);
      expect(own).toContain(`<result_id>${mint.RESULT_ID}</result_id>`);
      expect(own).toContain(`<iso_url>\`${mint.ISO_URL}\`</iso_url>`);
      expect(own).toContain(`<server_url>\`${SERVER}\`</server_url>`);
      expect(own).toContain(`<pinned_server>\`${mint.PINNED_SERVER}\`</pinned_server>`);
      expect(own).toContain(`<name>${mint.INSTALL_NAME}</name>`);
      expect(own).toContain(`<description>${mint.INSTALL_DESCRIPTION}</description>`);
      expect(own).toContain(`<instruction>${mint.INSTALL_INSTRUCTION}</instruction>`);
      expect(own).toContain(`<proof>${mint.INSTALL_PROOF}</proof>`);
      expect(own).not.toContain("<version>");
      expect(own).not.toContain("<mission>");
      // Not the test ticket with the words changed: none of its framing survives.
      expect(own).not.toContain("Test driver");
      expect(own).not.toContain("deliver a verdict");
      expect(own).not.toContain("analyze your session");
      expect(own).not.toContain("carry out the mission");
      expect(own).toContain("not a test");
      // Both guides, since the driver may read nothing else.
      expect(description).toContain("# Client\n");
      expect(description).toContain("## reserve");
      expect(description).toContain("## save");
      expect(description).toContain("# Control\n");
      expect(description).toContain("## test start");
      expect(description).toContain("## test-results");
      expect(description).not.toContain("## diagnose");
    }),
  );

  it.effect(
    "the differences a mint driver must know are spelled out in the template's own words",
    () =>
      Effect.gen(function* () {
        const own = ownWords(yield* real(Prompts.renderMintIssue(mint)));
        // The machine is this server and no other, taken by the driver's own pinned reserve.
        expect(own).toContain(`--server ${mint.PINNED_SERVER}`);
        expect(own).toContain(`./client relinquish --agent-id OLI-42 --server-url ${SERVER}`);
        // Fresh only: the flags that boot or attach a disk are named as forbidden.
        expect(own).toMatch(/never[^.\n]*--resume/i);
        expect(own).toMatch(/never[^.\n]*--disk/i);
        // The iso stays attached and boots first after the installer's reboot.
        expect(own).toMatch(/reboot/i);
        expect(own).toMatch(/boots first|boot menu/i);
        // A second look before the disk is kept for good.
        expect(own).toContain(SUB_AGENT);
        // Save ends it, never stop; the verdict follows save.
        expect(own).toMatch(/save[^.\n]*(never|not) stop/i);
        expect(own).toMatch(/test-results[^\n]*after[^\n]*save|after[^\n]*save[^\n]*test-results/i);
        // Linear status: In Progress, as the driving agent's own prompt says.
        expect(own).toContain('"In Progress"');
        expect(own).toContain('"Needs Review"');
        expect(own).not.toContain("In Review");
      }),
  );

  it.effect("the example session runs the mint in order and never stops a good install", () =>
    Effect.gen(function* () {
      const example = exampleOf(yield* real(Prompts.renderMintIssue(mint)));
      const at = (text: string) => {
        const index = example.indexOf(text);
        expect(index, text).toBeGreaterThan(-1);
        return index;
      };
      const relinquishAt = at(`./client relinquish --agent-id OLI-42 --server-url ${SERVER}`);
      const reserveAt = at(
        `./client reserve --agent-id OLI-42 --server-url ${SERVER} --server ${mint.PINNED_SERVER}`,
      );
      const startAt = at(
        `./client start --agent-id OLI-42 --server-url ${SERVER} --iso ${mint.ISO_URL}\n`,
      );
      const tiedAt = at(`./ctrl test start --session-id`);
      const saveAt = at(`./client save --agent-id OLI-42 --server-url ${SERVER} --session-id`);
      const verdictAt = at(
        `./ctrl test-results --agent-id OLI-42 --id ${mint.RESULT_ID} --status success`,
      );
      expect(reserveAt).toBeGreaterThan(relinquishAt);
      expect(startAt).toBeGreaterThan(reserveAt);
      expect(tiedAt).toBeGreaterThan(startAt);
      expect(saveAt).toBeGreaterThan(tiedAt);
      expect(verdictAt).toBeGreaterThan(saveAt);
      // The failed save is shown too, and it is a verdict, not a stop.
      at(`./ctrl test-results --agent-id OLI-42 --id ${mint.RESULT_ID} --status failed --reason`);
      expect(example).not.toContain("--resume");
      expect(example).not.toContain("--disk");
      expect(example).not.toMatch(/\.\/client stop/);
      expect(example).toContain('"In Progress"');
      expect(example).toContain('"Needs Review"');
    }),
  );

  it.effect("every way out closes the result, and only a good install is saved", () =>
    Effect.gen(function* () {
      const own = ownWords(yield* real(Prompts.renderMintIssue(mint)));
      // Three failed starts: give the reservation back, close the result, finish.
      expect(own).toMatch(/three[^\n]*start[^\n]*relinquish/i);
      // A failed install with a session: serial dump, result failed, stop failed, never save.
      expect(own).toContain("--status failed --reason");
      expect(own).toMatch(/never save/i);
      expect(own).toMatch(/serial dump/i);
      // A failed save: the session is over, the result is failed with its headline, no stop.
      expect(own).toMatch(/save fails/i);
      expect(own).toMatch(/nothing (to stop|was kept)/i);
      // The result is never left open.
      expect(own).toMatch(/result[^.]*(left open|open)/i);
    }),
  );
});

describe("renderMintIssue unhappy path", () => {
  it.effect("a missing value names the mint template", () =>
    Effect.gen(function* () {
      const fs = promptFs({ contents: { "mint-issue.html": "{{RUN_ID}} {{NOPE}}" } });
      const error = yield* Effect.flip(
        Prompts.renderMintIssue(mint).pipe(Effect.provide(fs.layer)),
      );
      expect(error).toMatchObject({
        _tag: "PromptError",
        message: "prompt: prompts/mint-issue.html uses {{NOPE}}, which has no value",
      });
    }),
  );

  it.effect(
    "an unreadable mint template is a PromptError naming it, before any guide is read",
    () =>
      Effect.gen(function* () {
        const fs = promptFs({ unreadable: /mint-issue\.html$/ });
        const error = yield* Effect.flip(
          Prompts.renderMintIssue(mint).pipe(Effect.provide(fs.layer)),
        );
        expect(error).toMatchObject({
          _tag: "PromptError",
          message: expect.stringContaining("mint-issue.html"),
        });
        expect(fileNames(fs.reads)).toEqual(["mint-issue.html"]);
      }),
  );
});
