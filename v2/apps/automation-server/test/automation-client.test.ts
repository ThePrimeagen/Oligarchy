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
const CLIENT_URL = "http://10.0.0.7:4100";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const QEMU_SERVER = "http://10.0.0.5:4000";
const PROMPT = "You are the driving agent for job 6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11.";
// Far below the HTTP default, so a call that kept it would time out here.
const DEFAULT_TIMEOUT_MS = 5;

const OK = Fake.json({});
const POSTED = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const posted = (path: string, body: Record<string, unknown>): Fake.Asked => ({
  url: `${CLIENT_URL}/${path}`,
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

// The automation client at CLIENT_URL, faked: one reply for every request, one per request in
// order, or one made from the request.
const client = async (
  replies: Parameters<typeof Fake.http>[0]["replies"],
  options: { readonly signal?: AbortSignal } = {},
) => {
  const fake = Fake.http({ replies, timeoutMs: DEFAULT_TIMEOUT_MS });
  const at: AutomationClient.Client = {
    http: fake.http,
    url: CLIENT_URL,
    token: await token(),
    ...options,
  };
  return { client: at, asked: fake.asked };
};

const later = (ms: number, reply: Response): Promise<Response> =>
  new Promise((resolve) => setTimeout(() => resolve(reply), ms));

describe("the automation server's calls to an automation client", () => {
  describe("reserve", () => {
    it("posts its request as it is, with the bearer, and answers reserved (happy)", async () => {
      const { client: at, asked } = await client(OK);
      const requests: ReadonlyArray<AutomationClient.ReserveRequest> = [
        { job: JOB, action: "drive", iso: ISO, mode: "resume" },
        { job: JOB, action: "drive", iso: ISO, mode: "fresh" },
        { job: JOB, action: "setup", iso: ISO, server: QEMU_SERVER },
        { job: JOB, action: "diagnose" },
      ];

      const answers = [];
      for (const request of requests) {
        answers.push(await AutomationClient.reserve(at, request));
      }

      expect(answers).toEqual(requests.map(() => jarl.ok("reserved")));
      expect(asked).toEqual(requests.map((request) => posted("reserve", request)));
    });

    it("refused 503, a client already at its --max-jobs, answers at-capacity: no failure (unhappy)", async () => {
      const { client: at } = await client(Fake.json({ error: "at capacity" }, 503));

      const reserved = await AutomationClient.reserve(at, { job: JOB, action: "diagnose" });

      expect(reserved).toEqual(jarl.ok("at-capacity"));
    });

    it("refused 409, a resume no qemu server holds a setup disk for yet, answers setup-needed: no failure (unhappy)", async () => {
      const { client: at } = await client(Fake.json({ error: "setup needed" }, 409));

      const reserved = await AutomationClient.reserve(at, {
        job: JOB,
        action: "drive",
        iso: ISO,
        mode: "resume",
      });

      expect(reserved).toEqual(jarl.ok("setup-needed"));
    });

    it("answered by any other 5xx fails as HttpServerError, naming the client's reason (unhappy)", async () => {
      const { client: at } = await client(Fake.json({ error: "proxy unreachable" }, 502));

      const reserved = await AutomationClient.reserve(at, { job: JOB, action: "diagnose" });

      const failed = Fake.failure(reserved, Http.HttpServerError);
      expect(failed.status).toBe(502);
      expect(failed.message).toBe(
        `POST ${CLIENT_URL}/reserve: 502: ${JSON.stringify({ error: "proxy unreachable" })}`,
      );
    });
  });

  describe("run", () => {
    it("posts its job and prompt, and answers ended once the client answers, however long past the HTTP default that is (happy)", async () => {
      const { client: at, asked } = await client(() => later(DEFAULT_TIMEOUT_MS * 10, OK));

      const ran = await AutomationClient.run(at, { job: JOB, prompt: PROMPT });

      expect(ran).toEqual(jarl.ok("ended"));
      expect(asked).toEqual([posted("run", { job: JOB, prompt: PROMPT })]);
    });

    it("answered 409, a run an abort ended, answers aborted: no failure (unhappy)", async () => {
      const { client: at } = await client(Fake.json({ error: "aborted" }, 409));

      const ran = await AutomationClient.run(at, { job: JOB, prompt: PROMPT });

      expect(ran).toEqual(jarl.ok("aborted"));
    });

    it("answered 500, a driver that failed, fails as HttpServerError naming the client's reason (unhappy)", async () => {
      const { client: at } = await client(
        Fake.json({ error: "driver exited 1: OpenRouterUnreachable" }, 500),
      );

      const ran = await AutomationClient.run(at, { job: JOB, prompt: PROMPT });

      const failed = Fake.failure(ran, Http.HttpServerError);
      expect(failed.body).toBe(JSON.stringify({ error: "driver exited 1: OpenRouterUnreachable" }));
    });

    it("ends its wait as Aborted when the client's signal aborts, as a shutdown does (unhappy)", async () => {
      const shutdown = new AbortController();
      const { client: at, asked } = await client("hang", { signal: shutdown.signal });

      const running = AutomationClient.run(at, { job: JOB, prompt: PROMPT });
      await later(DEFAULT_TIMEOUT_MS * 4, OK);
      shutdown.abort(new Async.Aborted("shutting down"));

      Fake.failure(await running, Async.Aborted);
      expect(asked).toHaveLength(1);
    });
  });

  describe("abort", () => {
    it("posts its job and answers stopped (happy)", async () => {
      const { client: at, asked } = await client(OK);

      const stopped = await AutomationClient.abort(at, { job: JOB });

      expect(stopped).toEqual(jarl.ok("stopped"));
      expect(asked).toEqual([posted("abort", { job: JOB })]);
    });

    it("answered 404, a job the client does not hold, answers not-held: no failure (unhappy)", async () => {
      const { client: at } = await client(Fake.json({ error: "job not found" }, 404));

      const stopped = await AutomationClient.abort(at, { job: JOB });

      expect(stopped).toEqual(jarl.ok("not-held"));
    });
  });
});
