import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as FakeFs from "../support/fake-fs.ts";

// The renderer is tested on templates written here, never on the files under prompts/: what those
// say is the prompt author's business and changes without the code. A guide is compared with the
// checkout's own file, whatever it says today.

const TEMPLATE_PATH = /\/prompts\/[^/]+\.html$/;

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

// The checkout's own file, from the repository root.
const fileOf = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(
      decodeURIComponent(new URL(`../../${name}`, import.meta.url).pathname),
    );
  }).pipe(Effect.provide(NodeFileSystem.layer));

// A FileSystem whose every template says `text`; every other read — a guide — is the checkout's
// own file.
const templateOf = (text: string): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(FileSystem.FileSystem)(
    Effect.map(FileSystem.FileSystem, (real) =>
      FileSystem.makeNoop({
        readFileString: (path, encoding) =>
          TEMPLATE_PATH.test(path) ? Effect.succeed(text) : real.readFileString(path, encoding),
      }),
    ),
  ).pipe(Layer.provide(NodeFileSystem.layer));

// The renderer over a template that says `text`.
const replace = (text: string, values: Prompts.Values = {}) =>
  Prompts.render("linear-issue.html", values).pipe(Effect.provide(templateOf(text)));

// A FileSystem over scripted files: the template says `template`, a guide says `contents of
// <name>`, and a path `unreadable` matches fails as an unreadable file would. Every read is
// recorded so a test can say which files a rendering touched.
const promptFs = (
  options: { readonly template?: string; readonly unreadable?: RegExp } = {},
): { readonly reads: Array<string>; readonly layer: Layer.Layer<FileSystem.FileSystem> } => {
  const reads: Array<string> = [];
  const layer = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        reads.push(path);
        if (options.unreadable?.test(path) === true) {
          return Effect.fail(FakeFs.permissionDenied("open", path));
        }
        return Effect.succeed(
          TEMPLATE_PATH.test(path) ? (options.template ?? "") : `contents of ${fileName(path)}`,
        );
      }),
  });
  return { reads, layer };
};

describe("render happy path", () => {
  it.effect("a placeholder becomes the value given, everywhere it appears", () =>
    Effect.gen(function* () {
      const text = yield* replace("ticket {{LINEAR_TICKET}}, again {{LINEAR_TICKET}}", {
        LINEAR_TICKET: "OLI-42",
      });
      expect(text).toBe("ticket OLI-42, again OLI-42");
    }),
  );

  it.effect("{{CTRL_MD}} is the contents of ctrl-linear.md, whatever it says", () =>
    Effect.gen(function* () {
      const guide = yield* fileOf("ctrl-linear.md");
      const text = yield* replace("{{CTRL_MD}}");
      // The guide's trailing newline is dropped so a closing tag after it sits under its last line.
      expect(text).toBe(guide.trimEnd());
    }),
  );

  it.effect("every guide the same way: {{CLIENT_MD}} and {{CTRL_DIAGNOSE_MD}}", () =>
    Effect.gen(function* () {
      for (const [name, file] of [
        ["CLIENT_MD", "client.md"],
        ["CTRL_DIAGNOSE_MD", "ctrl-diagnose.md"],
      ] as const) {
        const guide = yield* fileOf(file);
        expect(yield* replace(`{{${name}}}`)).toBe(guide.trimEnd());
      }
    }),
  );

  it.effect("{{SUB_AGENT}} is the constant", () =>
    Effect.gen(function* () {
      expect(yield* replace("{{SUB_AGENT}}")).toBe(Prompts.SUB_AGENT);
    }),
  );

  it.effect(
    "text that is not a placeholder stays, and a value the template does not use is ignored",
    () =>
      Effect.gen(function* () {
        const text = "{not a placeholder} {{lower}} {{}} { {SPACED} }";
        expect(yield* replace(text, { LINEAR_TICKET: "OLI-42" })).toBe(text);
      }),
  );
});

describe("render unhappy path", () => {
  it.effect("a placeholder with no value fails naming the template and the first such name", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        replace("{{RUN_ID}} {{NOPE}} {{ALSO}} {{CLIENT_MD}}", { RUN_ID: "r" }),
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
      const fs = promptFs({ template: "{{CLIENT_MD}}", unreadable: TEMPLATE_PATH });
      const error = yield* Effect.flip(
        Prompts.render("linear-issue.html", {}).pipe(Effect.provide(fs.layer)),
      );
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*linear-issue\.html/);
      expect(error.cause).toBeDefined();
      expect(fs.reads.map(fileName)).toEqual(["linear-issue.html"]);
    }),
  );

  it.effect("an unreadable guide the template names is a PromptError naming the guide", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        template: "{{CLIENT_MD}} {{CTRL_MD}} {{LINEAR_TICKET}}",
        unreadable: /ctrl-linear\.md$/,
      });
      const error = yield* Effect.flip(
        Prompts.render("linear-issue.html", { LINEAR_TICKET: "OLI-42" }).pipe(
          Effect.provide(fs.layer),
        ),
      );
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*ctrl-linear\.md/);
      expect(error.cause).toBeDefined();
      expect(fs.reads.map(fileName)).toEqual(["linear-issue.html", "client.md", "ctrl-linear.md"]);
    }),
  );

  it.effect(
    "a guide the template does not name is never read, so an unreadable one changes nothing",
    () =>
      Effect.gen(function* () {
        const fs = promptFs({ template: "{{LINEAR_TICKET}}", unreadable: /\.md$/ });
        const text = yield* Prompts.render("linear-issue.html", { LINEAR_TICKET: "OLI-42" }).pipe(
          Effect.provide(fs.layer),
        );
        expect(text).toBe("OLI-42");
        expect(fs.reads.map(fileName)).toEqual(["linear-issue.html"]);
      }),
  );
});
