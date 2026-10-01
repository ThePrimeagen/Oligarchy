import { testClient } from "hono/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Routes from "../src/routes.ts";
import { sessions } from "../src/testing.ts";

const TOKEN = "oligarchy-token";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const PROMPT = "You are the driving agent for job 6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11.";

const RESERVE: Routes.ReserveRequest = { job: JOB, action: "drive", iso: ISO, mode: "resume" };
const RUN: Routes.RunRequest = { job: JOB, prompt: PROMPT };
const ABORT: Routes.AbortRequest = { job: JOB };

// A null token sends no bearer at all.
const client = (made: Routes.Sessions, token: string | null = TOKEN) =>
  testClient(
    Routes.routes({ token: TOKEN, sessions: made }),
    {},
    undefined,
    token === null ? {} : { headers: { Authorization: `Bearer ${token}` } },
  );

describe("the automation client's routes", () => {
  it("refuse every request without the bearer, 401, and never ask the sessions (unhappy)", async () => {
    const { sessions: made, handed } = sessions();
    const without = client(made, null);
    const wrong = client(made, "not-the-token");

    const statuses = [
      (await without.reserve.$post({ json: RESERVE })).status,
      (await without.run.$post({ json: RUN })).status,
      (await without.abort.$post({ json: ABORT })).status,
      (await wrong.reserve.$post({ json: RESERVE })).status,
    ];

    expect(statuses).toEqual([401, 401, 401, 401]);
    expect(handed).toEqual([]);
  });

  it("refuse a body their schema refuses, 400, and never ask the sessions (unhappy)", async () => {
    const { sessions: made, handed } = sessions();
    const at = client(made);

    const answers = [
      // @ts-expect-error: a drive names its mode; the typed client refuses it as the route does.
      await at.reserve.$post({ json: { job: JOB, action: "drive", iso: ISO } }),
      // @ts-expect-error: a run names its prompt.
      await at.run.$post({ json: { job: JOB } }),
      // @ts-expect-error: an abort names its job, never a ticket.
      await at.abort.$post({ json: { ticket: "OLI-1" } }),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400]);
    expect(await Promise.all(answers.map((answer) => answer.json()))).toEqual([
      { error: "a reserve names its job and what it boots" },
      { error: "a run names its job and prompt" },
      { error: "an abort names its job" },
    ]);
    expect(handed).toEqual([]);
  });

  it("hand each request to the sessions as it is, and answer 200 once it went through (happy)", async () => {
    const { sessions: made, handed } = sessions();
    const at = client(made);

    const answers = [
      await at.reserve.$post({ json: RESERVE }),
      await at.run.$post({ json: RUN }),
      await at.abort.$post({ json: ABORT }),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    expect(handed).toEqual([RESERVE, RUN, ABORT]);
  });

  it("answer a reserve at --max-jobs 503, at capacity (unhappy)", async () => {
    const at = client(sessions({ reserve: async () => "at-capacity" }).sessions);

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "at capacity" });
  });

  it("answer a reserve no qemu server holds a setup disk for yet 409, setup needed (unhappy)", async () => {
    const at = client(sessions({ reserve: async () => "setup-needed" }).sessions);

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "setup needed" });
  });

  it("answer a run an abort ended 409, aborted (unhappy)", async () => {
    const at = client(sessions({ run: async () => jarl.ok("aborted") }).sessions);

    const answer = await at.run.$post({ json: RUN });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "aborted" });
  });

  it("answer a run whose driver failed 500, naming why (unhappy)", async () => {
    const at = client(
      sessions({
        run: async () => jarl.err(new Routes.RunFailed("driver exited 1: OpenRouterUnreachable")),
      }).sessions,
    );

    const answer = await at.run.$post({ json: RUN });

    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: "driver exited 1: OpenRouterUnreachable" });
  });

  it("answer an abort of a job they do not hold 404, job not found (unhappy)", async () => {
    const at = client(sessions({ abort: async () => "not-held" }).sessions);

    const answer = await at.abort.$post({ json: ABORT });

    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: "job not found" });
  });
});
