import type * as Db from "@oligarchy/db";
import type * as jarl from "jarl";
import type { Job, Needs } from "./needs.ts";

// A driver's last act is ./ctrl test-results. Until then its job is pending or running.
export const isOpen = (_job: Job): boolean => {
  throw new Error("not implemented");
};

export type Diagnosable =
  | { readonly kind: "ready" }
  | { readonly kind: "held" }
  | { readonly kind: "never"; readonly reason: string };

// A diagnose judges a drive or mint that ran to its end, so only a completed one is diagnosed.
// One still pending or running holds the diagnose; one that ended any other way, or none at all,
// means it never will be.
export const diagnosable = async (
  _needs: Pick<Needs, "automation">,
  _job: Job,
): Promise<jarl.Result<Diagnosable, Db.DatabaseError>> => {
  throw new Error("not implemented");
};
