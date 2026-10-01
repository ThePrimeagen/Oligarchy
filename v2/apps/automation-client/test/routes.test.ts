import { testClient } from "hono/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Jobs from "../src/jobs.ts";
import { routes } from "../src/routes.ts";

const TOKEN = "oligarchy-token";
const JOB_ID = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const QEMU = "http://127.0.0.1:42069";

const client = (token?: string, jobs = Jobs.create()) =>
  testClient(
    routes({ token: TOKEN, jobs }),
    {},
    undefined,
    token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  );

// Whether promise has settled once everything already queued has run.
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

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

  it("/reserve and /run with the bearer and a fitting body are 501 until each is written (happy)", async () => {
    const answers = [
      await client(TOKEN).reserve.$post({ json: { jobId: JOB_ID, action: "drive", resume: ISO } }),
      await client(TOKEN).reserve.$post({
        json: { jobId: JOB_ID, action: "setup", setupServer: QEMU },
      }),
      await client(TOKEN).run.$post({ json: { jobId: JOB_ID, prompt: "drive the guest" } }),
    ];

    for (const response of answers) {
      expect(response.status).toBe(501);
    }
    expect(await answers[0]?.json()).toEqual({ error: "reserve is not written yet" });
    expect(await answers[2]?.json()).toEqual({ error: "run is not written yet" });
  });

  it("/abort of a job it holds aborts the job and answers 200 once its holder has let it go (happy)", async () => {
    const jobs = Jobs.create();
    const held = jarl.unwrap(jobs.hold(JOB_ID));

    const answering = client(TOKEN, jobs).abort.$post({ json: { jobId: JOB_ID } });

    expect(await settled(answering)).toBe(false);
    expect(held.signal.aborted).toBe(true);
    held.release();
    const response = await answering;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("/abort of a job it does not hold is 404, naming the job (unhappy)", async () => {
    const jobs = Jobs.create();
    const other = jarl.unwrap(jobs.hold("0d9f4b1a-5c2e-4f7a-8b3d-1e6a9c2f4b70"));

    const response = await client(TOKEN, jobs).abort.$post({ json: { jobId: JOB_ID } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: `job ${JOB_ID} is not held` });
    expect(other.signal.aborted).toBe(false);
  });
});
