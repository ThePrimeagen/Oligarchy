import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";

// A Linear ticket body is a template under `prompts/` with `{{NAME}}` placeholders, filled from
// the ticket's values: `linear-issue.html` for a test, `mint-issue.html` for a mint. The
// constants and the guides are the renderer's own, read from the checkout's root when the
// template names them.

export const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";
const TEST_TEMPLATE = "linear-issue.html";
const MINT_TEMPLATE = "mint-issue.html";

// The guides a template may embed, by the name it uses. Read only when named, so an unreadable
// guide cannot stop a command whose template does not embed it.
const GUIDES: Readonly<Record<string, string>> = {
  CLIENT_MD: "client.md",
  CTRL_MD: "ctrl-linear.md",
};

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

// src, the package, packages, v2: the checkout is four up.
const CHECKOUT = join(import.meta.dirname, "..", "..", "..", "..");

// The checkout's files, by their path from its root.
export type Prompts = {
  readonly read: (path: string) => Promise<jarl.Result<string, { readonly message: string }>>;
};

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

// The checkout this package sits in, read from disk.
export const files = (root = CHECKOUT): Prompts => ({
  read: jarl.fn(
    (path: string) => readFile(join(root, path), "utf8"),
    (thrown) => ({ message: thrown instanceof Error ? thrown.message : String(thrown) }),
  ),
});

const read = async (
  prompts: Prompts,
  path: string,
): Promise<jarl.Result<string, Errors.PromptError>> => {
  const text = await prompts.read(path);
  if (text.ok) {
    return text;
  }
  const error = new Errors.PromptError(`prompt: ${text.error.message}`);
  error.cause = text.error;
  return jarl.err(error);
};

// Fills every `{{NAME}}`; the first name without a value fails the rendering, naming the template.
const fill = (
  template: string,
  text: string,
  values: Readonly<Record<string, string>>,
): jarl.Result<string, Errors.PromptError> => {
  const missing: Array<string> = [];
  const filled = text.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    return value;
  });
  const [first] = missing;
  return first === undefined
    ? jarl.ok(filled)
    : jarl.err(
        new Errors.PromptError(`prompt: prompts/${template} uses {{${first}}}, which has no value`),
      );
};

const render = async (
  prompts: Prompts,
  template: string,
  values: Readonly<Record<string, string>>,
): Promise<jarl.Result<string, Errors.PromptError>> => {
  const text = await read(prompts, `prompts/${template}`);
  if (!text.ok) {
    return text;
  }
  const known: Record<string, string> = { SUB_AGENT, ...values };
  for (const [name, path] of Object.entries(GUIDES)) {
    if (text.value.includes(`{{${name}}}`)) {
      const guide = await read(prompts, path);
      if (!guide.ok) {
        return guide;
      }
      // A guide ends in a newline the template's closing tag should sit under, not after.
      known[name] = guide.value.trimEnd();
    }
  }
  return fill(template, text.value, known);
};

export const renderLinearIssue = (
  prompts: Prompts,
  values: Values,
): Promise<jarl.Result<string, Errors.PromptError>> => render(prompts, TEST_TEMPLATE, values);

export const renderMintIssue = (
  prompts: Prompts,
  values: MintValues,
): Promise<jarl.Result<string, Errors.PromptError>> => render(prompts, MINT_TEMPLATE, values);
