import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";

// One automation client, as the automation server reaches it. signal ends any call in flight.
export type Client = {
  readonly http: Http.Http;
  readonly url: string;
  readonly token: Env.Secret;
  readonly signal?: AbortSignal;
};

// Each request is the body posted, as it is. A drive and a setup take a guest on the proxy too: a
// drive boots its ISO from that ISO's setup disk when it resumes and fresh otherwise, and a setup
// boots fresh on the qemu server its setup lock names. A diagnose takes no guest.
export type ReserveRequest =
  | { readonly job: string; readonly action: "diagnose" }
  | {
      readonly job: string;
      readonly action: "drive";
      readonly iso: string;
      readonly mode: "resume" | "fresh";
    }
  | {
      readonly job: string;
      readonly action: "setup";
      readonly iso: string;
      readonly server: string;
    };
export type RunRequest = { readonly job: string; readonly prompt: string };
export type AbortRequest = { readonly job: string };

// A refusal is no failure: the job stays pending and is asked for again.
export type Reserved = "reserved" | "at-capacity" | "setup-needed";
// The driver or opencode ran to its end, or an abort ended it.
export type Ran = "ended" | "aborted";
// A client that does not hold the job has nothing to stop.
export type Stopped = "stopped" | "not-held";

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

const where = (client: Client, path: string): string =>
  new URL(path, client.url.endsWith("/") ? client.url : `${client.url}/`).toString();

// Carries OLIGARCHY_TOKEN as the bearer. Nothing is asked again.
const posting = (
  client: Client,
  request: Readonly<Record<string, unknown>>,
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

export const reserve = async (client: Client, request: ReserveRequest): Answer<Reserved> => {
  const reserved = await client.http.fetch(where(client, "reserve"), posting(client, request), {
    decode: answering("reserved"),
    status: { 409: () => new SetupNeeded("setup needed") },
  });
  if (jarl.error.is(reserved, SetupNeeded)) {
    return jarl.ok("setup-needed");
  }
  if (jarl.error.is(reserved, Http.HttpServerError) && reserved.error.status === 503) {
    return jarl.ok("at-capacity");
  }
  return reserved;
};

// Answers once the driver or opencode has ended, however long that takes, unless the client's
// signal aborts first.
export const run = async (client: Client, request: RunRequest): Answer<Ran> => {
  const ran = await client.http.fetch(
    where(client, "run"),
    posting(client, request, { timeoutMs: RUN_TIMEOUT_MS }),
    { decode: answering("ended"), status: { 409: () => new RunAborted("aborted") } },
  );
  if (jarl.error.is(ran, RunAborted)) {
    return jarl.ok("aborted");
  }
  return ran;
};

export const abort = async (client: Client, request: AbortRequest): Answer<Stopped> => {
  const stopped = await client.http.fetch(where(client, "abort"), posting(client, request), {
    decode: answering("stopped"),
  });
  if (jarl.error.is(stopped, Http.HttpNotFound)) {
    return jarl.ok("not-held");
  }
  return stopped;
};
