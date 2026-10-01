import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { routes } from "../src/routes.ts";

const TOKEN = "oligarchy-token";
const JOB_ID = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const SUITE_ID = "0d8a6b52-3c1f-4e2a-8b7d-5f9e1a2c3b4d";

const client = (token?: string) =>
  testClient(
    routes({ token: TOKEN }),
    {},
    undefined,
    token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  );

describe("the automation server's routes", () => {
  it("/abort with no bearer is 401 (unhappy)", async () => {
    const response = await client().abort.$post({ json: { jobId: JOB_ID } });

    expect(response.status).toBe(401);
  });

  it("/abort with the wrong bearer is 401 (unhappy)", async () => {
    const response = await client("not-the-token").abort.$post({ json: { jobId: JOB_ID } });

    expect(response.status).toBe(401);
  });

  it("/abort naming neither a job nor a suite is 400, saying so (unhappy)", async () => {
    const response = await client(TOKEN).abort.$post({
      // @ts-expect-error: the typed client refuses this body; the server must too.
      json: { ticket: "OLI-1" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a jobId or a suiteId" });
  });

  it("/abort naming both a job and a suite is 400: it aborts one job or one whole suite (unhappy)", async () => {
    const response = await client(TOKEN).abort.$post({
      // @ts-expect-error: the typed client refuses both; the server must too.
      json: { jobId: JOB_ID, suiteId: SUITE_ID },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a jobId or a suiteId" });
  });

  it("/abort naming a job is 501 until abort is written (happy)", async () => {
    const response = await client(TOKEN).abort.$post({ json: { jobId: JOB_ID } });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "abort is not written yet" });
  });
});
