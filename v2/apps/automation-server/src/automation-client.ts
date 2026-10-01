import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import { hc, type InferRequestType } from "hono/client";
import * as jarl from "jarl";

export type { Ran, Reserved, Stopped } from "@oligarchy/automation-client/routes";

// One automation client, as the automation server reaches it. signal ends any call in flight.
export type Client = {
  readonly http: Http.Http;
  readonly url: string;
  readonly token: Env.Secret;
  readonly signal?: AbortSignal;
};

// The automation client's routes are the one definition of each call: its body, its path and
// every status it answers. hono/client reads them; @oligarchy/http sends.
type Api = ReturnType<typeof hc<ClientRoutes.Routes>>;
type Route = "reserve" | "run" | "abort";
type Status<R extends Route> = Awaited<ReturnType<Api[R]["$post"]>>["status"];

export type ReserveRequest = InferRequestType<Api["reserve"]["$post"]>["json"];
export type RunRequest = InferRequestType<Api["run"]["$post"]>["json"];
export type AbortRequest = InferRequestType<Api["abort"]["$post"]>["json"];

const AT_CAPACITY = 503 satisfies Status<"reserve">;
const SETUP_NEEDED = 409 satisfies Status<"reserve">;
const RUN_ABORTED = 409 satisfies Status<"run">;
const NOT_HELD = 404 satisfies Status<"abort">;

type Answer<T> = Promise<jarl.Result<T, Http.HttpFailure>>;

// The client ends a run at its ceiling, so the wait has none of its own. A timer delay past
// 2^31 - 1 ms fires at once, so this is the longest a wait can be.
const RUN_TIMEOUT_MS = 2 ** 31 - 1;

const SetupNeeded = jarl.error.define("SetupNeeded");
const RunAborted = jarl.error.define("RunAborted");

const answering =
  <const T extends string>(value: T) =>
  () =>
    jarl.ok(value);

const api = (client: Client): Api => hc<ClientRoutes.Routes>(client.url);

// Carries OLIGARCHY_TOKEN as the bearer. Nothing is asked again.
const posting = (
  client: Client,
  request: ReserveRequest | RunRequest | AbortRequest,
  timeout: { readonly timeoutMs?: number } = {},
): Http.Init => ({
  method: "POST",
  headers: {
    Authorization: `Bearer ${client.token.reveal()}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
  ...timeout,
  ...(client.signal === undefined ? {} : { signal: client.signal }),
});

export const reserve = async (
  client: Client,
  request: ReserveRequest,
): Answer<ClientRoutes.Reserved> => {
  const reserved = await client.http.fetch(
    api(client).reserve.$url().toString(),
    posting(client, request),
    {
      decode: answering("reserved"),
      status: { [SETUP_NEEDED]: () => new SetupNeeded("setup needed") },
    },
  );
  if (jarl.error.is(reserved, SetupNeeded)) {
    return jarl.ok("setup-needed");
  }
  if (jarl.error.is(reserved, Http.HttpServerError) && reserved.error.status === AT_CAPACITY) {
    return jarl.ok("at-capacity");
  }
  return reserved;
};

// Answers once the driver or opencode has ended, however long that takes, unless the client's
// signal aborts first.
export const run = async (client: Client, request: RunRequest): Answer<ClientRoutes.Ran> => {
  const ran = await client.http.fetch(
    api(client).run.$url().toString(),
    posting(client, request, { timeoutMs: RUN_TIMEOUT_MS }),
    { decode: answering("ended"), status: { [RUN_ABORTED]: () => new RunAborted("aborted") } },
  );
  if (jarl.error.is(ran, RunAborted)) {
    return jarl.ok("aborted");
  }
  return ran;
};

export const abort = async (
  client: Client,
  request: AbortRequest,
): Answer<ClientRoutes.Stopped> => {
  const stopped = await client.http.fetch(
    api(client).abort.$url().toString(),
    posting(client, request),
    { decode: answering("stopped") },
  );
  if (jarl.error.is(stopped, Http.HttpNotFound) && stopped.error.status === NOT_HELD) {
    return jarl.ok("not-held");
  }
  return stopped;
};
