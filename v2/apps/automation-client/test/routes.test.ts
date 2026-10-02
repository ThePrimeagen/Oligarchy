import { testClient } from "hono/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { AlreadyHeld, ShuttingDown } from "../src/jobs.ts";
import {
  type Sessions,
  AtCapacity,
  ReserveFailed,
  RunFailed,
  SetupNeeded,
  routes,
} from "../src/routes.ts";
import { sessions } from "../src/testing.ts";

const TOKEN = "oligarchy-token";
const JOB_ID = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const QEMU = "http://127.0.0.1:42069";

const client = (token?: string) =>
  testClient(
    routes({ token: TOKEN }),
    {},
    undefined,
    token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  );

const RESERVE = { jobId: JOB_ID, action: "drive", resume: ISO } as const;
const RUN = { jobId: JOB_ID, prompt: "drive the guest" };
const ABORT = { jobId: JOB_ID };

// The routes over sessions, with the bearer.
const handedTo = (made: Sessions) =>
  testClient(routes({ token: TOKEN, sessions: made }), {}, undefined, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

describe("the automation client's routes", () => {
  it("a route with no bearer is 401 (unhappy)", async () => {
    const response = await client().reserve.$post({ json: { jobId: JOB_ID, action: "diagnose" } });

    expect(response.status).toBe(401);
  });

  it("/reserve with a body that does not fit its action is 400, and the typed client refuses it (unhappy)", async () => {
    const setupWithoutServer = await client(TOKEN).reserve.$post({
      // @ts-expect-error: a setup names the qemu server its setup lock names.
      json: { jobId: JOB_ID, action: "setup" },
    });
    const driveWithServer = await client(TOKEN).reserve.$post({
      // @ts-expect-error: only a setup names a server.
      json: { jobId: JOB_ID, action: "drive", setupServer: QEMU },
    });

    for (const response of [setupWithoutServer, driveWithServer]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "name a jobId and an action: a drive may name resume, a setup names setupServer",
      });
    }
  });

  it("/run without a prompt is 400, and the typed client refuses it (unhappy)", async () => {
    const response = await client(TOKEN).run.$post({
      // @ts-expect-error: a run carries its prompt.
      json: { jobId: JOB_ID },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a jobId and a prompt" });
  });

  it("/abort without a jobId is 400, and the typed client refuses it (unhappy)", async () => {
    const response = await client(TOKEN).abort.$post({
      // @ts-expect-error: an abort names its job.
      json: {},
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a jobId" });
  });

  it("/reserve, /run and /abort with the bearer and a fitting body are 501 until each is written (happy)", async () => {
    const answers = [
      await client(TOKEN).reserve.$post({ json: { jobId: JOB_ID, action: "drive", resume: ISO } }),
      await client(TOKEN).reserve.$post({
        json: { jobId: JOB_ID, action: "setup", setupServer: QEMU },
      }),
      await client(TOKEN).run.$post({ json: { jobId: JOB_ID, prompt: "drive the guest" } }),
      await client(TOKEN).abort.$post({ json: { jobId: JOB_ID } }),
    ];

    for (const response of answers) {
      expect(response.status).toBe(501);
    }
    expect(await answers[0]?.json()).toEqual({ error: "reserve is not written yet" });
    expect(await answers[2]?.json()).toEqual({ error: "run is not written yet" });
    expect(await answers[3]?.json()).toEqual({ error: "abort is not written yet" });
  });

  it("hand each request to its session as it is, and answer 200 once it went through (happy)", async () => {
    const { sessions: made, handed } = sessions();
    const at = handedTo(made);

    const answers = [
      await at.reserve.$post({ json: RESERVE }),
      await at.run.$post({ json: RUN }),
      await at.abort.$post({ json: ABORT }),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    expect(handed).toEqual([RESERVE, RUN, ABORT]);
  });

  it("never hand a session a request without the bearer or with a body it refuses (unhappy)", async () => {
    const { sessions: made, handed } = sessions();
    const without = testClient(routes({ token: TOKEN, sessions: made }));

    const answers = [
      await without.reserve.$post({ json: RESERVE }),
      // @ts-expect-error: a run carries its prompt.
      await handedTo(made).run.$post({ json: { jobId: JOB_ID } }),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([401, 400]);
    expect(handed).toEqual([]);
  });

  it("answer a reserve at --max-jobs 503, naming it (unhappy)", async () => {
    const at = handedTo(
      sessions({ reserve: async () => jarl.err(new AtCapacity("at capacity: max-jobs is 1")) })
        .sessions,
    );

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "at capacity: max-jobs is 1" });
  });

  it("answer a reserve no qemu server holds a setup disk for yet 409, naming it (unhappy)", async () => {
    const at = handedTo(
      sessions({ reserve: async () => jarl.err(new SetupNeeded("setup needed: 4.0.4")) }).sessions,
    );

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "setup needed: 4.0.4" });
  });

  it("answer a reserve once shutdown has begun 503, naming it (unhappy)", async () => {
    const at = handedTo(
      sessions({
        reserve: async () => jarl.err(new ShuttingDown(`shutting down; job ${JOB_ID} not held`)),
      }).sessions,
    );

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: `shutting down; job ${JOB_ID} not held` });
  });

  it("answer a reserve of a job already held 400, naming it (unhappy)", async () => {
    const at = handedTo(
      sessions({
        reserve: async () => jarl.err(new AlreadyHeld(`job ${JOB_ID} is already held`)),
      }).sessions,
    );

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: `job ${JOB_ID} is already held` });
  });

  it("answer a reserve whose guest could not be reserved 500, naming why (unhappy)", async () => {
    const at = handedTo(
      sessions({
        reserve: async () =>
          jarl.err(new ReserveFailed("reserving a guest failed: POST /reserve: 500")),
      }).sessions,
    );

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: "reserving a guest failed: POST /reserve: 500" });
  });

  it("answer a run an abort ended 409, aborted (unhappy)", async () => {
    const at = handedTo(sessions({ run: async () => jarl.ok("aborted") }).sessions);

    const answer = await at.run.$post({ json: RUN });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "aborted" });
  });

  it("answer a run whose driver failed 500, naming why (unhappy)", async () => {
    const at = handedTo(
      sessions({
        run: async () => jarl.err(new RunFailed("driver exited 1: OpenRouterUnreachable")),
      }).sessions,
    );

    const answer = await at.run.$post({ json: RUN });

    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: "driver exited 1: OpenRouterUnreachable" });
  });

  it("answer an abort of a job they do not hold 404, job not found (unhappy)", async () => {
    const at = handedTo(sessions({ abort: async () => "not-held" }).sessions);

    const answer = await at.abort.$post({ json: ABORT });

    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: "job not found" });
  });
});
