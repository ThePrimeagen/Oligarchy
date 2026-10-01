import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { routes } from "../src/routes.ts";

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
});
