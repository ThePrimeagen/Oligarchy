import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";

// A Linear ticket body is a template under `prompts/` with `{{NAME}}` placeholders, filled from
// the ticket's values: `linear-issue.html` for a test, `mint-issue.html` for a mint. The
// constants and the guides are the renderer's own, read from the checkout's root when the
// template names them.

export const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

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
export const files = (_root?: string): Prompts => {
  throw new Error("not implemented");
};

export const renderLinearIssue = async (
  _prompts: Prompts,
  _values: Values,
): Promise<jarl.Result<string, Errors.PromptError>> => {
  throw new Error("not implemented");
};

export const renderMintIssue = async (
  _prompts: Prompts,
  _values: MintValues,
): Promise<jarl.Result<string, Errors.PromptError>> => {
  throw new Error("not implemented");
};
