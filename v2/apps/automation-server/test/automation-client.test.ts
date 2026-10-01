import { readFileSync } from "node:fs";
import * as Async from "@oligarchy/async";
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as AutomationClient from "../src/automation-client.ts";

const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const TOKEN = "oligarchy-s3cret";
const CLIENT = "http://10.0.0.7:4100";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const QEMU_SERVER = "http://10.0.0.5:4000";
const PROMPT = "You are the driving agent for job 6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11.";
// Far below the HTTP default, so a call that kept it would time out here.
const DEFAULT_TIMEOUT_MS = 5;

const OK = Fake.json({});
const POSTED = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const posted = (path: string, body: Record<string, unknown>): Fake.Asked => ({
  url: `${CLIENT}/${path}`,
  method: "POST",
  headers: POSTED,
  body,
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const token = async () =>
  jarl.unwrap(
    await Env.create(
      Env.cli({ name: "automation-client-test", description: "" }).needs("oligarchyToken").done(),
      Env.fakeIo({ env: { OLIGARCHY_TOKEN: TOKEN }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  ).vars.oligarchyToken;

// The calls over a fake automation client: one reply for every request, one per request in
// order, or one made from the request.
const client = async (replies: Parameters<typeof Fake.http>[0]["replies"]) => {
  const fake = Fake.http({ replies, timeoutMs: DEFAULT_TIMEOUT_MS });
  const automationClient = AutomationClient.create({ http: fake.http }, { token: await token() });
  return { automationClient, asked: fake.asked };
};

const later = (ms: number, reply: Response): Promise<Response> =>
  new Promise((resolve) => setTimeout(() => resolve(reply), ms));

describe("the automation server's calls to an automation client", () => {
  describe("reserve", () => {
    it("names its job and what it boots, with the bearer, and answers reserved (happy)", async () => {
      const { automationClient, asked } = await client(OK);

      const answers = [
        await automationClient.reserve(CLIENT, JOB, { action: "drive", iso: ISO, resume: true }),
        await automationClient.reserve(CLIENT, JOB, { action: "drive", iso: ISO, resume: false }),
        await automationClient.reserve(CLIENT, JOB, {
          action: "setup",
          iso: ISO,
          server: QEMU_SERVER,
        }),
        await automationClient.reserve(CLIENT, JOB, { action: "diagnose" }),
      ];

      expect(answers).toEqual([
        jarl.ok("reserved"),
        jarl.ok("reserved"),
        jarl.ok("reserved"),
        jarl.ok("reserved"),
      ]);
      expect(asked).toEqual([
        posted("reserve", { job: JOB, action: "drive", iso: ISO, mode: "resume" }),
        posted("reserve", { job: JOB, action: "drive", iso: ISO, mode: "fresh" }),
        posted("reserve", { job: JOB, action: "setup", iso: ISO, server: QEMU_SERVER }),
        posted("reserve", { job: JOB, action: "diagnose" }),
      ]);
    });

    it("refused 503, a client already at its --max-jobs, answers at-capacity: no failure (unhappy)", async () => {
      const { automationClient } = await client(Fake.json({ error: "at capacity" }, 503));

      const reserved = await automationClient.reserve(CLIENT, JOB, { action: "diagnose" });

      expect(reserved).toEqual(jarl.ok("at-capacity"));
    });

    it("refused 409, a resume no qemu server holds a setup disk for yet, answers setup-needed: no failure (unhappy)", async () => {
      const { automationClient } = await client(Fake.json({ error: "setup needed" }, 409));

      const reserved = await automationClient.reserve(CLIENT, JOB, {
        action: "drive",
        iso: ISO,
        resume: true,
      });

      expect(reserved).toEqual(jarl.ok("setup-needed"));
    });

    it("answered by any other 5xx fails as HttpServerError, naming the client's reason (unhappy)", async () => {
      const { automationClient } = await client(Fake.json({ error: "proxy unreachable" }, 502));

      const reserved = await automationClient.reserve(CLIENT, JOB, { action: "diagnose" });

      const failed = Fake.failure(reserved, Http.HttpServerError);
      expect(failed.status).toBe(502);
      expect(failed.message).toBe(
        `POST ${CLIENT}/reserve: 502: ${JSON.stringify({ error: "proxy unreachable" })}`,
      );
    });
  });

  describe("run", () => {
    it("names its job and prompt, and answers ended once the client answers, however long past the HTTP default that is (happy)", async () => {
      const { automationClient, asked } = await client(() => later(DEFAULT_TIMEOUT_MS * 10, OK));

      const ran = await automationClient.run(CLIENT, JOB, PROMPT);

      expect(ran).toEqual(jarl.ok("ended"));
      expect(asked).toEqual([posted("run", { job: JOB, prompt: PROMPT })]);
    });

    it("answered 409, a run an abort ended, answers aborted: no failure (unhappy)", async () => {
      const { automationClient } = await client(Fake.json({ error: "aborted" }, 409));

      const ran = await automationClient.run(CLIENT, JOB, PROMPT);

      expect(ran).toEqual(jarl.ok("aborted"));
    });

    it("answered 500, a driver that failed, fails as HttpServerError naming the client's reason (unhappy)", async () => {
      const { automationClient } = await client(
        Fake.json({ error: "driver exited 1: OpenRouterUnreachable" }, 500),
      );

      const ran = await automationClient.run(CLIENT, JOB, PROMPT);

      const failed = Fake.failure(ran, Http.HttpServerError);
      expect(failed.body).toBe(JSON.stringify({ error: "driver exited 1: OpenRouterUnreachable" }));
    });

    it("ends its wait as Aborted when the caller's signal aborts, as a shutdown does (unhappy)", async () => {
      const { automationClient, asked } = await client("hang");
      const shutdown = new AbortController();

      const running = automationClient.run(CLIENT, JOB, PROMPT, { signal: shutdown.signal });
      await later(DEFAULT_TIMEOUT_MS * 4, OK);
      shutdown.abort(new Async.Aborted("shutting down"));

      Fake.failure(await running, Async.Aborted);
      expect(asked).toHaveLength(1);
    });
  });

  describe("abort", () => {
    it("names its job and answers stopped (happy)", async () => {
      const { automationClient, asked } = await client(OK);

      const stopped = await automationClient.abort(CLIENT, JOB);

      expect(stopped).toEqual(jarl.ok("stopped"));
      expect(asked).toEqual([posted("abort", { job: JOB })]);
    });

    it("answered 404, a job the client does not hold, answers not-held: no failure (unhappy)", async () => {
      const { automationClient } = await client(Fake.json({ error: "job not found" }, 404));

      const stopped = await automationClient.abort(CLIENT, JOB);

      expect(stopped).toEqual(jarl.ok("not-held"));
    });
  });
});
