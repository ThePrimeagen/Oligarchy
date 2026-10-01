import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as FakeClient from "./fake-automation-client.ts";

const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const CLIENT = "http://10.0.0.7:4100";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const PROMPT = "You are the driving agent for job 6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11.";

describe("the fake automation client", () => {
  it("reserves, runs to the end and stops when told nothing, keeping each call (happy)", async () => {
    const { automationClient, calls } = FakeClient.automationClient();

    const reserved = await automationClient.reserve(CLIENT, JOB, {
      action: "drive",
      iso: ISO,
      resume: true,
    });
    const ran = await automationClient.run(CLIENT, JOB, PROMPT);
    const stopped = await automationClient.abort(CLIENT, JOB);

    expect([reserved, ran, stopped]).toEqual([
      jarl.ok("reserved"),
      jarl.ok("ended"),
      jarl.ok("stopped"),
    ]);
    expect(calls).toEqual([
      {
        call: "reserve",
        client: CLIENT,
        job: JOB,
        reserve: { action: "drive", iso: ISO, resume: true },
      },
      { call: "run", client: CLIENT, job: JOB, prompt: PROMPT },
      { call: "abort", client: CLIENT, job: JOB },
    ]);
  });

  it("answers each refusal it is told to, as the client does: at capacity, setup needed, aborted, not held (unhappy)", async () => {
    const atCapacity = FakeClient.automationClient({ reserve: () => "at-capacity" });
    const setupNeeded = FakeClient.automationClient({ reserve: () => "setup-needed" });
    const aborted = FakeClient.automationClient({ run: () => "aborted" });
    const notHeld = FakeClient.automationClient({ abort: () => "not-held" });

    expect([
      await atCapacity.automationClient.reserve(CLIENT, JOB, { action: "diagnose" }),
      await setupNeeded.automationClient.reserve(CLIENT, JOB, { action: "diagnose" }),
      await aborted.automationClient.run(CLIENT, JOB, PROMPT),
      await notHeld.automationClient.abort(CLIENT, JOB),
    ]).toEqual([
      jarl.ok("at-capacity"),
      jarl.ok("setup-needed"),
      jarl.ok("aborted"),
      jarl.ok("not-held"),
    ]);
  });

  it.each<{
    readonly kind: FakeClient.FailureKind;
    readonly error: abstract new (...args: never[]) => Error;
  }>([
    { kind: "unreachable", error: Http.HttpUnreachable },
    { kind: "timed-out", error: Http.HttpTimedOut },
    { kind: "bad-request", error: Http.HttpBadRequest },
    { kind: "not-found", error: Http.HttpNotFound },
    { kind: "server-error", error: Http.HttpServerError },
    { kind: "unhandled", error: Http.HttpUnhandled },
    { kind: "invalid", error: Http.HttpInvalid },
    { kind: "aborted", error: Async.Aborted },
  ])(
    "fails each call with @oligarchy/http's $kind, naming the client's path (unhappy)",
    async ({ kind, error }) => {
      const { automationClient } = FakeClient.automationClient({
        reserve: (call) => FakeClient.failure(kind, call),
        run: (call) => FakeClient.failure(kind, call),
        abort: (call) => FakeClient.failure(kind, call),
      });

      const failures = [
        Fake.failure(await automationClient.reserve(CLIENT, JOB, { action: "diagnose" }), error),
        Fake.failure(await automationClient.run(CLIENT, JOB, PROMPT), error),
        Fake.failure(await automationClient.abort(CLIENT, JOB), error),
      ];

      if (kind !== "aborted") {
        expect(failures[0]?.message).toContain(`POST ${CLIENT}/reserve`);
        expect(failures[1]?.message).toContain(`POST ${CLIENT}/run`);
        expect(failures[2]?.message).toContain(`POST ${CLIENT}/abort`);
      }
    },
  );

  it("ends an answer still pending as Aborted when the caller's signal aborts, and sends nothing on a signal already aborted (unhappy)", async () => {
    const { automationClient, calls } = FakeClient.automationClient({
      run: () => new Promise<never>(() => {}),
    });
    const shutdown = new AbortController();

    const running = automationClient.run(CLIENT, JOB, PROMPT, { signal: shutdown.signal });
    shutdown.abort(new Async.Aborted("shutting down"));
    const never = await automationClient.abort(CLIENT, JOB, { signal: shutdown.signal });

    expect(Fake.failure(await running, Async.Aborted).message).toBe("shutting down");
    Fake.failure(never, Async.Aborted);
    expect(calls).toEqual([{ call: "run", client: CLIENT, job: JOB, prompt: PROMPT }]);
  });
});
