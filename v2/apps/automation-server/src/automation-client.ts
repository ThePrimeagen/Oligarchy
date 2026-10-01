import * as App from "@oligarchy/app";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";

// What a reserve holds the client's slot for. A drive and a setup take a guest on the proxy too: a
// drive boots its ISO from that ISO's setup disk when it resumes and fresh otherwise, and a setup
// boots fresh on the qemu server its setup lock names. A diagnose takes no guest.
export type Reserve =
  | { readonly action: "diagnose" }
  | { readonly action: "drive"; readonly iso: string; readonly resume: boolean }
  | { readonly action: "setup"; readonly iso: string; readonly server: string };

// A refusal is no failure: the job stays pending and is asked for again.
export type Reserved = "reserved" | "at-capacity" | "setup-needed";
// The driver or opencode ran to its end, or an abort ended it.
export type Ran = "ended" | "aborted";
// A client that does not hold the job has nothing to stop.
export type Stopped = "stopped" | "not-held";

export type Call = { readonly signal?: AbortSignal };

type Answer<T> = Promise<jarl.Result<T, Http.HttpFailure>>;

// The automation server's calls to one automation client at its url. Each names its job and
// carries OLIGARCHY_TOKEN as the bearer; nothing is asked again.
export type AutomationClient = {
  readonly service: "automationClient";
  readonly reserve: (
    client: string,
    job: string,
    reserve: Reserve,
    call?: Call,
  ) => Answer<Reserved>;
  // Answers once the driver or opencode has ended, however long that takes, unless call's signal
  // aborts first.
  readonly run: (client: string, job: string, prompt: string, call?: Call) => Answer<Ran>;
  readonly abort: (client: string, job: string, call?: Call) => Answer<Stopped>;
};

declare module "@oligarchy/app" {
  interface Services {
    automationClient: App.Register<"automationClient", AutomationClient>;
  }
}

// The client ends a run at its ceiling, so the wait has none of its own. A timer delay past
// 2^31 - 1 ms fires at once, so this is the longest a wait can be.
const RUN_TIMEOUT_MS = 2 ** 31 - 1;

const SetupNeeded = jarl.error.define("SetupNeeded");
const RunAborted = jarl.error.define("RunAborted");

const answering =
  <const T extends string>(value: T) =>
  () =>
    jarl.ok(value);

const boot = (reserve: Reserve): Readonly<Record<string, string>> => {
  if (reserve.action === "diagnose") {
    return { action: reserve.action };
  }
  if (reserve.action === "drive") {
    return { action: reserve.action, iso: reserve.iso, mode: reserve.resume ? "resume" : "fresh" };
  }
  return { action: reserve.action, iso: reserve.iso, server: reserve.server };
};

export type Options = { readonly token: Env.Secret };

export const create = App.createService<Http.Http, Options, AutomationClient>(
  ({ http }, { token }) => {
    const where = (client: string, path: string): string =>
      new URL(path, client.endsWith("/") ? client : `${client}/`).toString();

    const posting = (
      job: string,
      fields: Readonly<Record<string, unknown>>,
      call: Call,
      timeout: { readonly timeoutMs?: number } = {},
    ): Http.Init => ({
      method: "POST",
      headers: { Authorization: `Bearer ${token.reveal()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ job, ...fields }),
      ...timeout,
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });

    return {
      service: "automationClient",
      reserve: async (client, job, reserve, call = {}) => {
        const reserved = await http.fetch(
          where(client, "reserve"),
          posting(job, boot(reserve), call),
          {
            decode: answering("reserved"),
            status: { 409: () => new SetupNeeded("setup needed") },
          },
        );
        if (jarl.error.is(reserved, SetupNeeded)) {
          return jarl.ok("setup-needed");
        }
        if (jarl.error.is(reserved, Http.HttpServerError) && reserved.error.status === 503) {
          return jarl.ok("at-capacity");
        }
        return reserved;
      },
      run: async (client, job, prompt, call = {}) => {
        const ran = await http.fetch(
          where(client, "run"),
          posting(job, { prompt }, call, { timeoutMs: RUN_TIMEOUT_MS }),
          { decode: answering("ended"), status: { 409: () => new RunAborted("aborted") } },
        );
        if (jarl.error.is(ran, RunAborted)) {
          return jarl.ok("aborted");
        }
        return ran;
      },
      abort: async (client, job, call = {}) => {
        const stopped = await http.fetch(where(client, "abort"), posting(job, {}, call), {
          decode: answering("stopped"),
        });
        if (jarl.error.is(stopped, Http.HttpNotFound)) {
          return jarl.ok("not-held");
        }
        return stopped;
      },
    };
  },
);
