import { Array as Arr, Effect, FileSystem, Option, Result } from "effect";
import * as Errors from "../shared/errors.ts";

// The Linear ticket body is `prompts/linear-issue.html` with `{{NAME}}` placeholders, filled
// from the ticket's values. The constants and the guides are the renderer's own, read from
// beside the package when the template names them.

const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";
const TEMPLATE = "linear-issue.html";

// What the ticket asks for, keyed as the template spells it.
export type Values = {
  readonly LINEAR_TICKET: string;
  readonly RUN_ID: string;
  readonly RESULT_ID: string;
  readonly VERSION: string;
  readonly ISO_URL: string;
  readonly SERVER_URL: string;
  readonly TEST_NAME: string;
  readonly TEST_DESCRIPTION: string;
  readonly TEST_INSTRUCTION: string;
  readonly TEST_PROOF: string;
};

// The files sit beside the package, not the working directory: resolve them from this module.
const besideModule = (relative: string): string =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);

// The guides a template may embed, by the name it uses. Read only when named, so an unreadable
// guide cannot stop a command whose template does not embed it.
const GUIDES: Readonly<Record<string, string>> = {
  CLIENT_MD: besideModule("../../client.md"),
  CTRL_MD: besideModule("../../ctrl-linear.md"),
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
          message: `prompt: prompts/${TEMPLATE} uses {{${name}}}, which has no value`,
        }),
      ),
  });
};

export const renderLinearIssue = Effect.fn("Prompts.renderLinearIssue")(function* (
  values: Values,
) {
  const text = yield* read(besideModule(`../../prompts/${TEMPLATE}`));
  const known: Record<string, string> = { SUB_AGENT, ...values };
  for (const [name, path] of Object.entries(GUIDES)) {
    if (text.includes(`{{${name}}}`)) {
      // A guide ends in a newline the template's closing tag should sit under, not after.
      known[name] = (yield* read(path)).trimEnd();
    }
  }
  return yield* Effect.fromResult(fill(text, known));
});
