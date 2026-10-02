import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import * as HttpClient from "@oligarchy/http/client";

// The client ends a run at its ceiling, so the wait has none of its own. A timer delay past
// 2^31 - 1 ms fires at once, so this is the longest a wait can be.
const RUN_TIMEOUT_MS = 2 ** 31 - 1;

// A client answers an abort once the job is let go: its child gets SIGTERM, SIGKILL 5 seconds
// later, and up to 2 more to drain its stderr; a reservation gives its guest back first.
const ABORT_TIMEOUT_MS = 15_000;

// One automation client at its url, typed by its routes. A refusal is no failure: a reserve the
// client is too full for, or that needs a setup first, leaves the job pending to ask again; a
// run an abort ended is the abort's to close; an abort of a job it does not hold has nothing to
// stop. A run answers once the driver or opencode has ended, unless the signal aborts first.
export const create = (options: HttpClient.Options) =>
  HttpClient.create<ClientRoutes.Routes>()(options, {
    "/reserve": { ok: "reserved", 503: "at-capacity", 409: "setup-needed" },
    "/run": { ok: "ended", 409: "aborted", timeoutMs: RUN_TIMEOUT_MS },
    "/abort": { ok: "stopped", 404: "not-held", timeoutMs: ABORT_TIMEOUT_MS },
  });

export type AutomationClient = ReturnType<typeof create>;
