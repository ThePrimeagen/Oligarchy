import type * as Db from "@oligarchy/db";
import type * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";
import type { Needs } from "./needs.ts";

// The one definition a mint installs from, and the label its tickets carry beside the agent test
// label the automation server watches.
export const MINT_DEFINITION = "mint";
export const MINT_LABEL = "mint";

export type Refused =
  | Errors.NoDefinition
  | Errors.PromptError
  | Db.DatabaseError
  | Linear.LinearError
  | Linear.LinearUnavailable;

export type Definition = Pick<
  Stores.Tests.DefinitionRow,
  "id" | "name" | "description" | "instruction" | "proof"
>;

export type Opened = {
  readonly id: string;
  readonly tests: ReadonlyArray<{ readonly id: string; readonly linear: Linear.Ticket }>;
};

export type Minted = {
  readonly id: string;
  readonly result: string;
  readonly server: string;
  readonly linear: Linear.Ticket;
};

type Filing = Pick<Needs, "tests" | "linear" | "logger" | "prompts">;

// The install's wording, refused before anything is created when nobody has defined it.
export const mintDefinition = async (
  _needs: Pick<Needs, "tests">,
): Promise<jarl.Result<Stores.Tests.DefinitionRow, Errors.NoDefinition | Db.DatabaseError>> => {
  throw new Error("not implemented");
};

// `./ctrl test run --name <definition>`, and `test run testsuite`, which names none: one pending
// job per definition (the suite leaves the mint install out), each in its newest wording, and
// one ticket each. Returns the run and its tickets and prints nothing but its line.
export const open = async (
  _needs: Filing,
  _input: {
    readonly serverUrl: string;
    readonly iso: string;
    readonly version: string;
    readonly name?: string;
  },
): Promise<jarl.Result<Opened, Refused>> => {
  throw new Error("not implemented");
};

// The proxy's first reserve of an iso on a qemu server: one mint job and its ticket, pinned to
// that server. The pin goes on the setup row before the ticket reaches Automation Needed, or the
// dispatcher would reserve the mint with no server; a setup row gone by then is SetupGone and the
// ticket stays in Backlog. Linear refusing the team opens no run.
export const openMint = async (
  _needs: Filing & Pick<Needs, "setupRequests">,
  _input: { readonly iso: string; readonly serverUrl: string; readonly pinned: string },
): Promise<
  jarl.Result<
    { readonly id: string; readonly result: string; readonly linear: Linear.Ticket },
    Refused | Errors.SetupGone
  >
> => {
  throw new Error("not implemented");
};

// `./ctrl mint`: one mint job and its ticket per server, in order, the team asked for once. Each
// claims that server's setup lock with its result before the ticket moves, since the lock is where
// the dispatcher reads a mint's pin; ctrl has no hold of the proxy's, so the lock and its result
// go in one write. A lock a mint in flight holds is refused. The first failure stops the rest.
export const openMints = async (
  _needs: Filing & Pick<Needs, "setupRequests">,
  _input: {
    readonly iso: string;
    readonly serverUrl: string;
    readonly definition: Definition;
    readonly servers: ReadonlyArray<string>;
  },
): Promise<jarl.Result<ReadonlyArray<Minted>, Refused | Errors.SetupHeld>> => {
  throw new Error("not implemented");
};
