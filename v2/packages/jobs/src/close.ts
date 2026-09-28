import type * as Db from "@oligarchy/db";
import type * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";
import type { Action, Needs } from "./needs.ts";

// errored is the system failing the action, never the test, and always says why.
export type Outcome =
  | { readonly status: "errored"; readonly reason: string }
  | {
      readonly status: Exclude<Stores.Automation.FinishStatus, "errored">;
      readonly reason: string | null;
    };

// What an action made of a driver that exited cleanly.
export const judge = async (
  _needs: Pick<Needs, "tests" | "sessions">,
  _action: Action,
): Promise<jarl.Result<Outcome, Db.DatabaseError>> => {
  throw new Error("not implemented");
};

// Three attempts, then a line. The action is already closed; a board that will not move does
// not reopen it.
export const moveTicket = async (
  _needs: Pick<Needs, "logger">,
  _ticket: string,
  _column: string,
  _move: () => Promise<jarl.Result<void, unknown>>,
): Promise<void> => {
  throw new Error("not implemented");
};

// The system failed the action. A drive's or mint's job is errored with it, since whatever
// verdict it had is not the test's; a diagnose leaves the job it was judging alone. The ticket
// moves to Errored with the reason. Neither failing unwinds the close: each is a line.
export const fail = async (
  _needs: Pick<Needs, "tests" | "linear" | "logger">,
  _action: Action,
  _ticket: string | null,
  _reason: string,
): Promise<void> => {
  throw new Error("not implemented");
};

// True when this call closed the row. Three attempts at the write; a row that still will not
// close stays running for an operator to mark, and the line names the status it should have.
// Then the ticket: a drive or mint gives up its ready label; errored moves to Errored; a drive
// or mint that completed goes to Needs Review; a diagnose that succeeded goes to Succeeded or
// Failed by its verdict; aborted stays where it was.
export const close = async (
  _needs: Pick<Needs, "automation" | "tests" | "diagnosis" | "linear" | "logger">,
  _action: Action,
  _outcome: Outcome,
): Promise<jarl.Result<boolean, Db.DatabaseError>> => {
  throw new Error("not implemented");
};
