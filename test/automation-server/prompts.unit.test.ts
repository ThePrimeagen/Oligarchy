import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import * as Prompts from "../../src/automation-server/prompts.ts";
import * as FakeFs from "../support/fake-fs.ts";

const TICKET = "OLI-42";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";

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

describe("drive happy path", () => {
  it.effect("fills the ticket and the model", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: {
          "driving-agent.html": "ticket {{LINEAR_TICKET}} as {{MODEL}}",
        },
      });
      const text = yield* Prompts.drive(TICKET).pipe(Effect.provide(fs.layer));
      expect(text).toBe(`ticket ${TICKET} as ${Prompts.MODEL}`);
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
    }),
  );

  it.effect("driving-agent.html: the ticket, the model, no leftover placeholders", () =>
    Effect.gen(function* () {
      const text = yield* real(Prompts.drive(TICKET));
      expect(text.includes("{{")).toBe(false);
      expect(text).toContain(TICKET);
      expect(text).toContain(Prompts.MODEL);
      expect(text).toContain("driving agent");
    }),
  );
});

describe("diagnose happy path", () => {
  it.effect("fills the ticket, result, model, and the named diagnose guide", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: {
          "diagnosing-agent.html":
            "{{LINEAR_TICKET}} {{RESULT_ID}} {{MODEL}}\n<guide>\n{{CTRL_DIAGNOSE_MD}}\n</guide>",
          "ctrl-diagnose.md": "# Control\n\nDiagnose the session.\n",
        },
      });
      const text = yield* Prompts.diagnose(TICKET, RESULT_ID).pipe(Effect.provide(fs.layer));
      expect(text).toBe(
        `${TICKET} ${RESULT_ID} ${Prompts.MODEL}\n<guide>\n# Control\n\nDiagnose the session.\n</guide>`,
      );
      expect(fileNames(fs.reads)).toEqual(["diagnosing-agent.html", "ctrl-diagnose.md"]);
    }),
  );

  it.effect(
    "diagnosing-agent.html: the ticket, result, model, guide, no leftover placeholders",
    () =>
      Effect.gen(function* () {
        const text = yield* real(Prompts.diagnose(TICKET, RESULT_ID));
        expect(text.includes("{{")).toBe(false);
        expect(text).toContain(TICKET);
        expect(text).toContain(RESULT_ID);
        expect(text).toContain(Prompts.MODEL);
        expect(text).toContain("# Control");
        expect(text).toContain("## session");
        expect(text).toContain("Post-run reviewer");
      }),
  );
});

describe("drive and diagnose unhappy path", () => {
  it.effect("the first placeholder without a value is the one named", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: { "driving-agent.html": "{{LINEAR_TICKET}} {{NOPE}} {{ALSO}}" },
      });
      const error = yield* Effect.flip(Prompts.drive(TICKET).pipe(Effect.provide(fs.layer)));
      expect(error).toMatchObject({
        _tag: "PromptError",
        message: "prompt: prompts/driving-agent.html uses {{NOPE}}, which has no value",
      });
      expect(error.cause).toBeUndefined();
    }),
  );

  it.effect("an unreadable template is a PromptError naming it, before any guide is read", () =>
    Effect.gen(function* () {
      const fs = promptFs({ unreadable: /driving-agent\.html$/ });
      const error = yield* Effect.flip(Prompts.drive(TICKET).pipe(Effect.provide(fs.layer)));
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*driving-agent\.html/);
      expect(error.cause).toBeDefined();
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
    }),
  );

  it.effect("an unreadable guide the template names is a PromptError naming the guide", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        unreadable: /ctrl-diagnose\.md$/,
        contents: { "diagnosing-agent.html": "{{CTRL_DIAGNOSE_MD}} {{LINEAR_TICKET}}" },
      });
      const error = yield* Effect.flip(
        Prompts.diagnose(TICKET, RESULT_ID).pipe(Effect.provide(fs.layer)),
      );
      expect(error._tag).toBe("PromptError");
      expect(error.message).toMatch(/^prompt: .*ctrl-diagnose\.md/);
      expect(error.cause).toBeDefined();
      expect(fileNames(fs.reads)).toEqual(["diagnosing-agent.html", "ctrl-diagnose.md"]);
    }),
  );

  it.effect("an unreadable guide the template does not name cannot stop a drive", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        unreadable: /ctrl-diagnose\.md$/,
        contents: { "driving-agent.html": "ticket {{LINEAR_TICKET}}" },
      });
      const text = yield* Prompts.drive(TICKET).pipe(Effect.provide(fs.layer));
      expect(text).toBe(`ticket ${TICKET}`);
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
    }),
  );
});
