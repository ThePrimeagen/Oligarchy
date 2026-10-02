import { testClient } from "hono/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import {
  type Router,
  RelinquishFailed,
  ReserveFailed,
  ReserveRefused,
  routes,
} from "../src/routes.ts";
import { router } from "../src/testing.ts";

const TOKEN = "oligarchy-token";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const HOST = "http://10.0.0.5:4000";

const RESERVE = { job: JOB, resume: ISO };
const RELINQUISH = { job: JOB };

const client = (token?: string) =>
  testClient(
    routes({ token: TOKEN }),
    {},
    undefined,
    token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  );

// The routes over a router, with the bearer.
const handedTo = (made: Router) =>
  testClient(routes({ token: TOKEN, router: made }), {}, undefined, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

describe("the qemu server's routes", () => {
  it("a route with no bearer is 401 (unhappy)", async () => {
    const response = await client().reserve.$post({ json: RESERVE });

    expect(response.status).toBe(401);
  });

  it("/reserve naming both an ISO to resume and a setup's server is 400, and the typed client refuses it (unhappy)", async () => {
    const response = await client(TOKEN).reserve.$post({
      // @ts-expect-error: a drive names the ISO it resumes, a setup its server, never both.
      json: { job: JOB, resume: ISO, setupServer: HOST },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "name a job: a drive may name resume, a setup names setupServer",
    });
  });

  it("/relinquish without a job is 400, and the typed client refuses it (unhappy)", async () => {
    const response = await client(TOKEN).relinquish.$post({
      // @ts-expect-error: a relinquish names its job.
      json: {},
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a job" });
  });

  it("/reserve and /relinquish with the bearer and a fitting body are 501 until each is written (unhappy)", async () => {
    const reserved = await client(TOKEN).reserve.$post({ json: RESERVE });
    const relinquished = await client(TOKEN).relinquish.$post({ json: RELINQUISH });

    expect(reserved.status).toBe(501);
    expect(await reserved.json()).toEqual({ error: "reserve is not written yet" });
    expect(relinquished.status).toBe(501);
    expect(await relinquished.json()).toEqual({ error: "relinquish is not written yet" });
  });

  it("hand each request to the router as it is, and answer 200 once it went through (happy)", async () => {
    const { router: made, handed } = router();
    const at = handedTo(made);
    const reserves = [RESERVE, { job: JOB }, { job: JOB, setupServer: HOST }];

    const answers = [];
    for (const json of reserves) {
      answers.push(await at.reserve.$post({ json }));
    }
    answers.push(await at.relinquish.$post({ json: RELINQUISH }));

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
    expect(handed).toEqual([...reserves, RELINQUISH]);
  });

  it("answer a reserve no qemu host has room for 503, at capacity (unhappy)", async () => {
    const at = handedTo(router({ reserve: async () => jarl.ok("at-capacity") }).router);

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "at capacity" });
  });

  it("answer a resume no qemu host holds a setup disk for yet 409, setup needed (unhappy)", async () => {
    const at = handedTo(router({ reserve: async () => jarl.ok("setup-needed") }).router);

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "setup needed" });
  });

  it("answer a reserve that placed no guest 400, naming why (unhappy)", async () => {
    const at = handedTo(
      router({
        reserve: async () => jarl.err(new ReserveRefused(`no qemu host ${HOST}`)),
      }).router,
    );

    const answer = await at.reserve.$post({ json: { job: JOB, setupServer: HOST } });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: `no qemu host ${HOST}` });
  });

  it("answer a reserve that failed once it may have placed a guest 500, naming why (unhappy)", async () => {
    const at = handedTo(
      router({
        reserve: async () => jarl.err(new ReserveFailed("route not saved: DATABASE FAILURE")),
      }).router,
    );

    const answer = await at.reserve.$post({ json: RESERVE });

    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: "route not saved: DATABASE FAILURE" });
  });

  it("answer a relinquish of a job it holds no guest for 404, job not found (unhappy)", async () => {
    const at = handedTo(router({ relinquish: async () => jarl.ok("not-held") }).router);

    const answer = await at.relinquish.$post({ json: RELINQUISH });

    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: "job not found" });
  });

  it("answer a relinquish that failed 500, naming why (unhappy)", async () => {
    const at = handedTo(
      router({
        relinquish: async () => jarl.err(new RelinquishFailed(`qemu host ${HOST} unreachable`)),
      }).router,
    );

    const answer = await at.relinquish.$post({ json: RELINQUISH });

    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: `qemu host ${HOST} unreachable` });
  });
});
