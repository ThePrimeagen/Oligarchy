import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as Routes from "./routes.ts";

// The proxy probes every qemu server, each for up to 10 seconds, and then asks them one at a time.
const RESERVE_TIMEOUT_MS = 60_000;

// The reserves that take a guest.
export type GuestRequest = Exclude<Routes.ReserveRequest, { readonly action: "diagnose" }>;

export type Options = {
  readonly http: Http.Http;
  readonly url: string;
  readonly token: { readonly reveal: () => string };
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
  const base = options.url.endsWith("/") ? options.url : `${options.url}/`;

  const post = (
    path: string,
    body: Readonly<Record<string, string>>,
    extra: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ) =>
    options.http.fetch(
      new URL(path, base).toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token.reveal()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        ...extra,
      },
      { decode: () => jarl.ok(undefined) },
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
      const answered = await post("reserve", body, { timeoutMs: RESERVE_TIMEOUT_MS, signal });
      if (jarl.error.is(answered, Http.HttpServerError) && answered.error.status === 503) {
        return jarl.err(new Routes.AtCapacity(answered.error.message));
      }
      if (jarl.error.is(answered, Http.HttpUnhandled) && answered.error.status === 409) {
        return jarl.err(new Routes.SetupNeeded(answered.error.message));
      }
      return answered;
    },
    relinquish: async (jobId) => {
      const answered = await post("relinquish", { job: jobId }, {});
      // The proxy holds no guest for the job: it is already gone.
      if (jarl.error.is(answered, Http.HttpNotFound)) {
        return jarl.ok(undefined);
      }
      return answered;
    },
  };
};
