import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import * as Prompts from "../src/prompts.ts";
import * as TestingFs from "@oligarchy/testing/fs";

const TICKET = "OLI-42";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const MODEL = "opencode/muse-spark-1.3-contributor-free";

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
          ? Effect.fail(TestingFs.permissionDenied("open", path))
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
      const text = yield* Prompts.drive(TICKET, MODEL).pipe(Effect.provide(fs.layer));
      expect(text).toBe(`ticket ${TICKET} as ${MODEL}`);
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
    }),
  );

  it.effect("driving-agent.html: the ticket, the model, no leftover placeholders", () =>
    Effect.gen(function* () {
      const text = yield* real(Prompts.drive(TICKET, MODEL));
      expect(text.includes("{{")).toBe(false);
      expect(text).toContain(TICKET);
      expect(text).toContain(MODEL);
      expect(text).toContain("driving agent");
      expect(text).toContain("Do not call intent");
      expect(text).toContain("Do not call ./ctrl");
      expect(text).toContain("Do not call start, stop, or save.");
      expect(text).toContain("The harness starts the machine");
      expect(text).not.toContain("Start the machine exactly");
      expect(text).not.toContain("intent start");
      expect(text).not.toContain("test-results");
      expect(text).toContain(
        "the client tool's reason is that step's line exactly, with only the leading asterisk and the spaces beside it removed",
      );
      expect(text).toContain("any crashes or erroneous behavior must be reported");
      expect(text).toContain("Any crash or erroneous behavior must be reported");
      expect(text).toContain("always take a screen shot of every step");
      expect(text).toContain(
        "Move the mouse to the location you want to click, then take an image and validate the pointer is in the correct location before clicking.",
      );
      expect(text).toContain("best effort to complete the ticket");
      expect(text).not.toContain("In Progress");
      expect(text).not.toContain("Needs Review");
      expect(text.toLowerCase()).not.toContain("label");
      expect(text.toLowerCase()).not.toContain("set status");
    }),
  );

  it.effect(
    "driving-agent.html: Done follows the last step or a shutdown, and a ticket's save or stop is Done",
    () =>
      Effect.gen(function* () {
        const text = yield* real(Prompts.drive(TICKET, MODEL));
        expect(text).toMatch(/last ActionList step[^<]*call Done/);
        expect(text).toMatch(/shut the machine down[^<]*call Done/);
        expect(text).toMatch(/says save or stop[^<]*call Done/);
      }),
  );

  it.effect(
    "driving-agent.html: Done is not held until the proof is on screen, a proof only Done can finish (unhappy)",
    () =>
      Effect.gen(function* () {
        const text = yield* real(Prompts.drive(TICKET, MODEL));
        expect(text).not.toContain("When the proof is on screen, call Done.");
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
      const text = yield* Prompts.diagnose(TICKET, RESULT_ID, MODEL).pipe(Effect.provide(fs.layer));
      expect(text).toBe(
        `${TICKET} ${RESULT_ID} ${MODEL}\n<guide>\n# Control\n\nDiagnose the session.\n</guide>`,
      );
      expect(fileNames(fs.reads)).toEqual(["diagnosing-agent.html", "ctrl-diagnose.md"]);
    }),
  );

  it.effect(
    "diagnosing-agent.html: the ticket, result, model, guide, no leftover placeholders",
    () =>
      Effect.gen(function* () {
        const text = yield* real(Prompts.diagnose(TICKET, RESULT_ID, MODEL));
        expect(text.includes("{{")).toBe(false);
        expect(text).toContain(TICKET);
        expect(text).toContain(RESULT_ID);
        expect(text).toContain(MODEL);
        expect(text).toContain("# Control");
        expect(text).toContain("## session");
        expect(text).toContain("Post-run reviewer");
        expect(text).toContain("./ctrl diagnose");
        // The harness moves the ticket on the board; the reviewer never does.
        for (const column of ["In Review", "Needs Review", "In Progress", "Succeeded"]) {
          expect(text).not.toContain(column);
        }
        expect(text).not.toContain("Done");
        expect(text.toLowerCase()).not.toContain("label");
      }),
  );
});

describe("mission text", () => {
  const mission = {
    ticket: TICKET,
    name: "lock-screen",
    description: "the lock screen",
    instruction: "Press Super+Escape.",
    proof: "the clock is showing",
    iso: "https://example.com/omarchy.iso",
    serverUrl: "http://127.0.0.1:55555",
  };

  it.effect("names the instruction and the proof", () =>
    Effect.sync(() => {
      const text = Prompts.missionText(mission);
      expect(text).toContain("Press Super+Escape.");
      expect(text).toContain("the clock is showing");
      expect(text).toContain("<name>lock-screen</name>");
    }),
  );

  it.effect("does not tell the model to start the machine (unhappy for a model-issued boot)", () =>
    Effect.sync(() => {
      const text = Prompts.missionText(mission);
      expect(text).not.toContain("./client");
      expect(text).not.toContain("--resume");
      expect(text).not.toContain("<start>");
      expect(text).not.toContain("--agent-id");
      expect(text).not.toContain("--server-url");
      expect(text).not.toContain("--session-id");
    }),
  );
});

describe("drive and diagnose unhappy path", () => {
  it.effect("the first placeholder without a value is the one named", () =>
    Effect.gen(function* () {
      const fs = promptFs({
        contents: { "driving-agent.html": "{{LINEAR_TICKET}} {{NOPE}} {{ALSO}}" },
      });
      const error = yield* Effect.flip(Prompts.drive(TICKET, MODEL).pipe(Effect.provide(fs.layer)));
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
      const error = yield* Effect.flip(Prompts.drive(TICKET, MODEL).pipe(Effect.provide(fs.layer)));
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
        Prompts.diagnose(TICKET, RESULT_ID, MODEL).pipe(Effect.provide(fs.layer)),
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
      const text = yield* Prompts.drive(TICKET, MODEL).pipe(Effect.provide(fs.layer));
      expect(text).toBe(`ticket ${TICKET}`);
      expect(fileNames(fs.reads)).toEqual(["driving-agent.html"]);
    }),
  );
});
