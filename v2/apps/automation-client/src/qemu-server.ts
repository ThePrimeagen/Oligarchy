import type * as Http from "@oligarchy/http";
import * as HttpClient from "@oligarchy/http/client";
import type * as QemuRoutes from "@oligarchy/qemu-server/routes";
import * as jarl from "jarl";
import type * as Routes from "./routes.ts";

// The qemu server probes every qemu host, each for up to 10 seconds, and then asks them one at a
// time.
const RESERVE_TIMEOUT_MS = 60_000;

// The reserves that take a guest.
export type GuestRequest = Exclude<Routes.ReserveRequest, { readonly action: "diagnose" }>;

export type Options = Omit<HttpClient.Options, "signal">;

export type QemuServer = {
  // A refusal is no failure: every qemu host is full, or none with room holds the setup disk the
  // drive resumes. signal ends the call.
  readonly reserve: (
    request: GuestRequest,
    signal: AbortSignal,
  ) => Promise<jarl.Result<Routes.Reserved, Http.HttpFailure>>;
  readonly relinquish: (jobId: string) => Promise<jarl.Result<void, Http.HttpFailure>>;
};

// The qemu server at url, typed by its routes: each call names its job and carries the token as
// the bearer, and nothing is asked again.
export const create = (options: Options): QemuServer => {
  const client = (signal?: AbortSignal) =>
    HttpClient.create<QemuRoutes.Routes>()(
      signal === undefined ? options : { ...options, signal },
      {
        "/reserve": {
          ok: "reserved",
          503: "at-capacity",
          409: "setup-needed",
          timeoutMs: RESERVE_TIMEOUT_MS,
        },
        "/relinquish": { ok: "relinquished", 404: "not-held" },
      },
    );

  return {
    reserve: (request, signal) =>
      client(signal).post(
        "/reserve",
        request.action === "setup"
          ? { job: request.jobId, setupServer: request.setupServer }
          : {
              job: request.jobId,
              ...(request.resume === undefined ? {} : { resume: request.resume }),
            },
      ),
    relinquish: async (jobId) => {
      const relinquished = await client().post("/relinquish", { job: jobId });
      if (jarl.is_err(relinquished)) {
        return relinquished;
      }
      return jarl.ok(undefined);
    },
  };
};
