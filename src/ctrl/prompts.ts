import { Array as Arr, Effect, FileSystem, Option, Result } from "effect";
import * as Errors from "../shared/errors.ts";

// A Linear ticket body is a template under `prompts/` with `{{NAME}}` placeholders, filled from
// the ticket's values: `linear-issue.html` for a test, `mint-issue.html` for a mint. The
// constants and the guides are the renderer's own, read from beside the package when the
// template names them.

const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";
const TEST_TEMPLATE = "linear-issue.html";
const MINT_TEMPLATE = "mint-issue.html";

// What a test ticket asks for, keyed as the template spells it.
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

// What a mint ticket asks for: the run's ids, the install's wording from the `mint` definition,
// and the one qemu server the install is pinned to. No version: a mint is not a test of one.
export type MintValues = {
  readonly LINEAR_TICKET: string;
  readonly RUN_ID: string;
  readonly RESULT_ID: string;
  readonly ISO_URL: string;
  readonly SERVER_URL: string;
  readonly PINNED_SERVER: string;
  readonly INSTALL_NAME: string;
  readonly INSTALL_DESCRIPTION: string;
  readonly INSTALL_INSTRUCTION: string;
  readonly INSTALL_PROOF: string;
};

// Beside this module. workerd's `import.meta.url` is not a URL base, so the relative path stands;
// it still ends with the file the dashboard overlay serves. ./ctrl's base parses.
export const modulePath = (relative: string, base: string): string =>
  URL.canParse(relative, base) ? decodeURIComponent(new URL(relative, base).pathname) : relative;

const besideModule = (relative: string): string => modulePath(relative, import.meta.url);

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
  template: string,
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
          message: `prompt: prompts/${template} uses {{${name}}}, which has no value`,
        }),
      ),
  });
};

const render = Effect.fn("Prompts.render")(function* (
  template: string,
  values: Readonly<Record<string, string>>,
) {
  const text = yield* read(besideModule(`../../prompts/${template}`));
  const known: Record<string, string> = { SUB_AGENT, ...values };
  for (const [name, path] of Object.entries(GUIDES)) {
    if (text.includes(`{{${name}}}`)) {
      // A guide ends in a newline the template's closing tag should sit under, not after.
      known[name] = (yield* read(path)).trimEnd();
    }
  }
  return yield* Effect.fromResult(fill(template, text, known));
});

export const renderLinearIssue = Effect.fn("Prompts.renderLinearIssue")(function* (values: Values) {
  return yield* render(TEST_TEMPLATE, values);
});

export const renderMintIssue = Effect.fn("Prompts.renderMintIssue")(function* (values: MintValues) {
  return yield* render(MINT_TEMPLATE, values);
});
