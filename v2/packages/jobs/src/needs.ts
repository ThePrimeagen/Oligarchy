import type * as Linear from "@oligarchy/linear";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import type * as Templates from "./templates.ts";

// What jobs asks of each service, and nothing more; each function takes the part it uses.
export type Needs = {
  readonly tests: Pick<
    Stores.Tests.Tests,
    | "listTestDefinitions"
    | "findTestDefinition"
    | "createRun"
    | "failRun"
    | "setLinearId"
    | "errorResult"
    | "findResult"
    | "findResultByLinearId"
    | "definitionName"
  >;
  readonly automation: Pick<
    Stores.Automation.Automation,
    "enqueue" | "jobStatus" | "abortPending" | "finish"
  >;
  readonly sessions: Pick<Stores.Sessions.Sessions, "getSession">;
  readonly diagnosis: Pick<Stores.Diagnosis.Diagnosis, "getDiagnosis">;
  readonly setupRequests: Pick<Stores.SetupRequests.SetupRequests, "setResult" | "claim">;
  readonly servers: Pick<Stores.Servers.Servers, "findServer">;
  readonly linear: Pick<
    Linear.Linear,
    | "createTicket"
    | "setDescription"
    | "readyForAutomation"
    | "readyForReview"
    | "markSucceeded"
    | "markFailed"
    | "markErrored"
    | "markAborted"
  >;
  readonly logger: Logger.Logger;
  readonly prompts: Templates.Prompts;
};

// A job is a test result and its Linear ticket; an action is one of its automation_jobs rows.
export type Job = Stores.Tests.ResultRow;
export type Action = Stores.Automation.AutomationJobRow;
