import * as Http from "@oligarchy/http";
import * as Client from "@oligarchy/http/client";
import type { Routes as ServerRoutes } from "@oligarchy/qemu-server/routes";
import type { Hono } from "hono";
import type { ExtractSchema } from "hono/types";
import * as jarl from "jarl";
import * as Routes from "./routes.ts";

// The reserves that take a guest.
export type GuestRequest = Exclude<Routes.ReserveRequest, { readonly action: "diagnose" }>;

export type Options = {
  readonly http: Http.Http;
  readonly url: string;
  readonly token: { readonly reveal: () => string };
  // The proxy probes every qemu server before it asks them one at a time, so a reserve waits
  // longer than any one call.
  readonly reserveTimeoutMs: number;
  readonly releaseTimeoutMs: number;
};

export type Proxy = {
  // The proxy is full, or no qemu server with room holds the setup disk the drive resumes: each
  // a refusal that reserved nothing. signal ends the call.
  readonly reserve: (
    request: GuestRequest,
    signal: AbortSignal,
  ) => Promise<jarl.Result<void, Routes.AtCapacity | Routes.SetupNeeded | Http.HttpFailure>>;
  readonly relinquish: (jobId: string) => Promise<jarl.Result<void, Http.HttpFailure>>;
};

// The qemu reverse proxy at url, as the automation client calls it: each call names its job and
// carries the token as the bearer, and nothing is asked again.
export const create = (options: Options): Proxy => {
  type SelectedRoutes = Hono<{}, Pick<ExtractSchema<ServerRoutes>, "/reserve" | "/relinquish">>;
  const client = (signal?: AbortSignal) =>
    Client.create<SelectedRoutes>()(
      {
        http: options.http,
        url: options.url,
        token: options.token,
        ...(signal === undefined ? {} : { signal }),
      },
      {
        "/reserve": { ok: "reserved", timeoutMs: options.reserveTimeoutMs },
        "/relinquish": { ok: "released", timeoutMs: options.releaseTimeoutMs },
      },
    );

  return {
    reserve: async (request, signal) => {
      const body =
        request.action === "setup"
          ? { job: request.jobId, setupServer: request.setupServer }
          : {
              job: request.jobId,
              ...(request.resume === undefined ? {} : { resume: request.resume }),
            };
      const answered = await client(signal).post("/reserve", body);
      if (jarl.error.is(answered, Http.HttpServerError) && answered.error.status === 503) {
        return jarl.err(new Routes.AtCapacity(answered.error.message));
      }
      if (jarl.error.is(answered, Http.HttpUnhandled) && answered.error.status === 409) {
        return jarl.err(new Routes.SetupNeeded(answered.error.message));
      }
      return jarl.is_err(answered) ? answered : jarl.ok(undefined);
    },
    relinquish: async (jobId) => {
      const answered = await client().post("/relinquish", { job: jobId });
      // The proxy holds no guest for the job: it is already gone.
      if (jarl.error.is(answered, Http.HttpNotFound)) {
        return jarl.ok(undefined);
      }
      return jarl.is_err(answered) ? answered : jarl.ok(undefined);
    },
  };
};
