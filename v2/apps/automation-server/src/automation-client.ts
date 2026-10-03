import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import * as Http from "@oligarchy/http";
import * as HttpClient from "@oligarchy/http/client";
import * as jarl from "jarl";

// The client ends a run at its ceiling, so the wait has none of its own. A timer delay past
// 2^31 - 1 ms fires at once, so this is the longest a wait can be.
const RUN_TIMEOUT_MS = 2 ** 31 - 1;

// One automation client at its url, typed by its routes. A refusal is no failure: a reserve the
// client is too full for, or that needs a setup first, leaves the job pending to ask again; a
// run an abort ended is the abort's to close; an abort of a job it does not hold has nothing to
// stop. A run answers once the driver or opencode has ended, unless the signal aborts first; an
// abort, once the job is let go, within abortTimeoutMs.
export const create = (
  options: HttpClient.Options & {
    readonly abortTimeoutMs: number;
    readonly reserveTimeoutMs?: number;
  },
) =>
  HttpClient.create<ClientRoutes.Routes>()(options, {
    "/reserve": {
      ok: "reserved",
      503: "at-capacity",
      409: "setup-needed",
      ...(options.reserveTimeoutMs === undefined ? {} : { timeoutMs: options.reserveTimeoutMs }),
    },
    "/run": { ok: "ended", 409: "aborted", timeoutMs: RUN_TIMEOUT_MS },
    "/abort": { ok: "stopped", 404: "not-held", timeoutMs: options.abortTimeoutMs },
  });

export type AutomationClient = ReturnType<typeof create>;

// A run the client ended at a ceiling is answered 504, its body naming which. It stays a failure,
// not a word, so its reason reaches the close.
export const timedOut = (failure: Http.HttpFailure): boolean =>
  jarl.error.is(failure, Http.HttpServerError) && failure.status === 504;
