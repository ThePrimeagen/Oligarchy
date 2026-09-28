import type * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import type { Job, Needs } from "./needs.ts";

// A driver's last act is ./ctrl test-results. Until then its job is pending or running.
export const isOpen = (job: Job): boolean => job.status === "pending" || job.status === "running";

export type Diagnosable =
  | { readonly kind: "ready" }
  | { readonly kind: "held" }
  | { readonly kind: "stranded"; readonly reason: string };

// A diagnose judges a drive or mint that ran to its end, so only a completed one is diagnosed.
// One still pending or running holds the diagnose. One that ended any other way, or none at all,
// strands it: the diagnose is closed errored with the reason, which says all the job can, and its
// ticket moves to Errored.
export const diagnosable = async (
  needs: Pick<Needs, "automation">,
  job: Job,
): Promise<jarl.Result<Diagnosable, Db.DatabaseError>> => {
  const drive = await needs.automation.jobStatus(job.id, "drive");
  if (!drive.ok) {
    return drive;
  }
  let action = "drive";
  let ran = drive.value;
  if (ran === undefined) {
    const mint = await needs.automation.jobStatus(job.id, "mint");
    if (!mint.ok) {
      return mint;
    }
    action = "mint";
    ran = mint.value;
  }
  if (ran === "completed") {
    return jarl.ok({ kind: "ready" });
  }
  if (ran === "pending" || ran === "running") {
    return jarl.ok({ kind: "held" });
  }
  const why = job.reason === null ? "" : `: ${job.reason}`;
  return jarl.ok({
    kind: "stranded",
    reason: [
      "stranded",
      ran === undefined ? "no drive or mint" : `${action} ${ran}`,
      `result ${job.id} is ${job.status}${why}`,
      `session ${job.sessionId ?? "none"}`,
    ].join("; "),
  });
};
