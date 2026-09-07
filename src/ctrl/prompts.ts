import { Array as Arr, Effect, FileSystem, Option, Result } from "effect";
import * as Errors from "../shared/errors.ts";

// Every text ctrl hands an agent is a template under `prompts/` with `{{NAME}}` placeholders,
// filled from one value shape by `render`. The values a caller has are passed in; the constants
// and the guides are the renderer's own, read from beside the package when a template names them.

export const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

export type Template = "linear-issue.html" | "driving-agent.html" | "diagnosing-agent.html";

// What a caller can put into a template, keyed as the template spells it. A key the caller has
// no value for is absent; a template that asks for it does not render.
export type Values = {
  readonly LINEAR_TICKET?: string;
  // The model the driver runs as, which it records with `ctrl test start --model`.
  readonly MODEL?: string;
  readonly RUN_ID?: string;
  readonly RESULT_ID?: string;
  readonly SESSION_ID?: string;
  readonly VERSION?: string;
  readonly ISO_URL?: string;
  readonly SERVER_URL?: string;
  readonly TEST_NAME?: string;
  readonly TEST_DESCRIPTION?: string;
  readonly TEST_INSTRUCTION?: string;
  readonly TEST_PROOF?: string;
};

// The files sit beside the package, not the working directory: resolve them from this module.
const besideModule = (relative: string): string =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);

// The guides a template may embed, by the name it uses. Read only when named, so an unreadable
// guide cannot stop a command whose template does not embed it.
const GUIDES: Readonly<Record<string, string>> = {
  CLIENT_MD: besideModule("../../client.md"),
  CTRL_MD: besideModule("../../ctrl-linear.md"),
  CTRL_DIAGNOSE_MD: besideModule("../../ctrl-diagnose.md"),
};

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

const read = Effect.fn("Prompts.read")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path)
    .pipe(
      Effect.mapError((error) =>
        Errors.PromptError.make({ message: `prompt: ${error.message}`, cause: error }),
      ),
    );
});

// Fills every `{{NAME}}`; the first name without a value fails the rendering, naming the template.
const fill = (
  text: string,
  template: Template,
  values: Readonly<Record<string, string>>,
): Result.Result<string, Errors.PromptError> => {
  const missing: Array<string> = [];
  const filled = text.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    return value;
  });
  return Option.match(Arr.head(missing), {
    onNone: () => Result.succeed(filled),
    onSome: (name) =>
      Result.fail(
        Errors.PromptError.make({
          message: `prompt: prompts/${template} uses {{${name}}}, which has no value`,
        }),
      ),
  });
};

export const render = Effect.fn("Prompts.render")(function* (template: Template, values: Values) {
  const text = yield* read(besideModule(`../../prompts/${template}`));
  const known: Record<string, string> = { SUB_AGENT, ...values };
  for (const [name, path] of Object.entries(GUIDES)) {
    if (text.includes(`{{${name}}}`)) {
      // A guide ends in a newline the template's closing tag should sit under, not after.
      known[name] = (yield* read(path)).trimEnd();
    }
  }
  return yield* Effect.fromResult(fill(text, template, known));
});
