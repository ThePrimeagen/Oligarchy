// A fake automation client for tests: AutomationClient answering from what it is told instead of
// the network, and recording each call it was asked. Told nothing, it reserves, runs to the end
// and stops.
import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import type * as AutomationClient from "../src/automation-client.ts";

type Of<Name extends string, Fields> = {
  readonly call: Name;
  readonly client: string;
  readonly job: string;
} & Fields;

export type Reserving = Of<"reserve", { readonly reserve: AutomationClient.Reserve }>;
export type Running = Of<"run", { readonly prompt: string }>;
export type Aborting = Of<"abort", {}>;
export type Call = Reserving | Running | Aborting;

// A refusal or a failure, at once or once the promise settles. A call whose signal aborts first
// fails Aborted, as the real one does.
type Answer<T> = T | Http.HttpFailure | Promise<T | Http.HttpFailure>;

export type Answers = {
  readonly reserve?: (call: Reserving) => Answer<AutomationClient.Reserved>;
  readonly run?: (call: Running) => Answer<AutomationClient.Ran>;
  readonly abort?: (call: Aborting) => Answer<AutomationClient.Stopped>;
};

const FAILURES = {
  unreachable: (asked) => new Http.HttpUnreachable(asked, new TypeError("fetch failed")),
  "timed-out": (asked) => new Http.HttpTimedOut(asked, 10_000),
  "bad-request": (asked) =>
    new Http.HttpBadRequest(asked, 400, JSON.stringify({ error: "invalid body" }), new Headers()),
  "not-found": (asked) => new Http.HttpNotFound(asked, 404, "404 Not Found", new Headers()),
  "server-error": (asked) =>
    new Http.HttpServerError(asked, 500, JSON.stringify({ error: "internal" }), new Headers()),
  unhandled: (asked) => new Http.HttpUnhandled(asked, 418, "", new Headers()),
  invalid: (asked) => new Http.HttpInvalid("body is not JSON: Unexpected token", { asked }),
  aborted: () => new Async.Aborted("aborted"),
} satisfies Readonly<Record<string, (asked: Http.Asked) => Http.HttpFailure>>;

export type FailureKind = keyof typeof FAILURES;

// Each of @oligarchy/http's errors as the real call would fail with it, naming what call asked.
export const failure = (kind: FailureKind, call: Call): Http.HttpFailure =>
  FAILURES[kind]({
    method: "POST",
    url: new URL(call.call, call.client.endsWith("/") ? call.client : `${call.client}/`).toString(),
  });

const abortedBy = (signal: AbortSignal): Async.Aborted =>
  jarl.error.is(signal.reason, Async.Aborted) ? signal.reason : new Async.Aborted("aborted");

const isFailure = (answer: unknown): answer is Http.HttpFailure => answer instanceof Error;

export const automationClient = (
  answers: Answers = {},
): {
  readonly automationClient: App.Made<AutomationClient.AutomationClient>;
  // Every call sent, in the order it was asked; one whose signal had already aborted never is.
  readonly calls: ReadonlyArray<Call>;
} => {
  const calls: Array<Call> = [];

  const answer = async <C extends Call, T>(
    call: C,
    signal: AbortSignal | undefined,
    given: ((call: C) => Answer<T>) | undefined,
    otherwise: T,
  ): Promise<jarl.Result<T, Http.HttpFailure>> => {
    if (signal?.aborted === true) {
      return jarl.err(abortedBy(signal));
    }
    calls.push(call);
    const answered = Promise.resolve(given === undefined ? otherwise : given(call));
    const settled =
      signal === undefined
        ? await answered
        : await Promise.race([
            answered,
            new Promise<Async.Aborted>((resolve) => {
              signal.addEventListener("abort", () => resolve(abortedBy(signal)), { once: true });
            }),
          ]);
    return isFailure(settled) ? jarl.err(settled) : jarl.ok(settled);
  };

  const create = App.createService<never, App.NoOptions, AutomationClient.AutomationClient>(() => ({
    service: "automationClient",
    reserve: (client, job, reserve, call = {}) =>
      answer({ call: "reserve", client, job, reserve }, call.signal, answers.reserve, "reserved"),
    run: (client, job, prompt, call = {}) =>
      answer({ call: "run", client, job, prompt }, call.signal, answers.run, "ended"),
    abort: (client, job, call = {}) =>
      answer({ call: "abort", client, job }, call.signal, answers.abort, "stopped"),
  }));
  return { automationClient: create({}), calls };
};
