import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
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

describe("renderMintIssue happy path", () => {
  it.effect(
    "fills mint-issue.html from the mint values, the constants, and the guides it names",
    () =>
      Effect.gen(function* () {
        const fs = promptFs({
          contents: {
            "mint-issue.html":
              "{{LINEAR_TICKET}} on {{PINNED_SERVER}} via {{SERVER_URL}}; {{INSTALL_NAME}}: {{INSTALL_INSTRUCTION}}; by {{SUB_AGENT}}\n<guide>\n{{CLIENT_MD}}\n</guide>",
            "client.md": "# Client\n\nDrive the guest.\n",
          },
        });
        const text = yield* Prompts.renderMintIssue(mint).pipe(Effect.provide(fs.layer));
        expect(text).toBe(
          `OLI-42 on ${mint.PINNED_SERVER} via ${SERVER}; mint: ${mint.INSTALL_INSTRUCTION}; by ${SUB_AGENT}\n<guide>\n# Client\n\nDrive the guest.\n</guide>`,
        );
        // Its own template, then the one guide it names; the test ticket's template is never read.
        expect(fileNames(fs.reads)).toEqual(["mint-issue.html", "client.md"]);
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

describe("modulePath", () => {
  it.effect("resolves a file beside this module from a file url (happy)", () =>
    Effect.sync(() => {
      expect(Prompts.modulePath("../../client.md", import.meta.url)).toMatch(/\/client\.md$/);
      expect(Prompts.modulePath("../../prompts/linear-issue.html", import.meta.url)).toMatch(
        /\/prompts\/linear-issue\.html$/,
      );
    }),
  );

  it.effect("keeps the relative path when the base is not a url, as workerd's is (unhappy)", () =>
    Effect.sync(() => {
      expect(Prompts.modulePath("../../prompts/linear-issue.html", "not a url")).toBe(
        "../../prompts/linear-issue.html",
      );
      expect(Prompts.modulePath("../../client.md", "")).toBe("../../client.md");
    }),
  );
});
