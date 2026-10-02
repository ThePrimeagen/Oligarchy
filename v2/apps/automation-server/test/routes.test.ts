import * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import { testClient } from "hono/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Abort from "../src/abort.ts";
import { type AbortRequest, routes } from "../src/routes.ts";

const TOKEN = "oligarchy-token";
const JOB_ID = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const SUITE_ID = "0d8a6b52-3c1f-4e2a-8b7d-5f9e1a2c3b4d";

type Answer = Awaited<ReturnType<Abort.Aborter["abort"]>>;

const client = (options: { readonly token?: string; readonly answer?: Answer } = {}) => {
  const handed: Array<AbortRequest> = [];
  const abort: Abort.Aborter["abort"] = async (request) => {
    handed.push(request);
    return options.answer ?? jarl.ok(undefined);
  };
  const { token } = options;
  return {
    handed,
    api: testClient(
      routes({ token: TOKEN, abort }),
      {},
      undefined,
      token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
    ),
  };
};

describe("the automation server's routes", () => {
  it("/abort with no bearer is 401 (unhappy)", async () => {
    const { api, handed } = client();
    const response = await api.abort.$post({ json: { jobId: JOB_ID } });

    expect(response.status).toBe(401);
    expect(handed).toEqual([]);
  });

  it("/abort with the wrong bearer is 401 (unhappy)", async () => {
    const { api } = client({ token: "not-the-token" });
    const response = await api.abort.$post({ json: { jobId: JOB_ID } });

    expect(response.status).toBe(401);
  });

  it("/abort naming neither a job nor a suite is 400, saying so (unhappy)", async () => {
    const { api, handed } = client({ token: TOKEN });
    const response = await api.abort.$post({
      // @ts-expect-error: the typed client refuses this body; the server must too.
      json: { ticket: "OLI-1" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a jobId or a suiteId" });
    expect(handed).toEqual([]);
  });

  it("/abort naming both a job and a suite is 400: it aborts one job or one whole suite (unhappy)", async () => {
    const { api } = client({ token: TOKEN });
    const response = await api.abort.$post({
      // @ts-expect-error: the typed client refuses both; the server must too.
      json: { jobId: JOB_ID, suiteId: SUITE_ID },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name a jobId or a suiteId" });
  });

  it("/abort hands the job or the suite to abort and answers 200 once it is aborted (happy)", async () => {
    const { api, handed } = client({ token: TOKEN });

    const byJob = await api.abort.$post({ json: { jobId: JOB_ID } });
    const bySuite = await api.abort.$post({ json: { suiteId: SUITE_ID } });

    expect([byJob.status, bySuite.status]).toEqual([200, 200]);
    expect(await byJob.json()).toEqual({});
    expect(handed).toEqual([{ jobId: JOB_ID }, { suiteId: SUITE_ID }]);
  });

  it.each([
    [404, new Stores.Tests.NotFound(`getJob: no job ${JOB_ID}`)],
    [409, new Abort.NothingToAbort(`job ${JOB_ID} is completed; nothing to abort`)],
    [502, new Abort.NotStopped(`job ${JOB_ID} could not be stopped: fetch failed`)],
    [500, new Db.DatabaseError("connection refused")],
  ])(
    "/abort answers %i naming why when abort is refused with that error (unhappy)",
    async (status, error) => {
      const { api } = client({ token: TOKEN, answer: jarl.err(error) });

      const response = await api.abort.$post({ json: { jobId: JOB_ID } });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: error.message });
    },
  );
});
