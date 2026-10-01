import { readFileSync } from "node:fs";
import * as ClientRoutes from "@oligarchy/automation-client/routes";
import * as FakeSessions from "@oligarchy/automation-client/testing";
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
const DEFAULT_TIMEOUT_MS = 50;

const POSTED = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const posted = (path: string, body: unknown): Fake.Asked => ({
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

// The automation client at CLIENT_URL: its own routes behind the fake transport, over sessions
// answering as told, so each call is answered as that client answers it.
const served = async (told: Partial<ClientRoutes.Sessions> = {}) => {
  const { sessions, handed } = FakeSessions.sessions(told);
  const routes = ClientRoutes.routes({ token: TOKEN, sessions });
  const fake = Fake.http({
    replies: (asked) =>
      routes.fetch(
        new Request(asked.url, {
          method: asked.method,
          headers: asked.headers,
          body: JSON.stringify(asked.body),
        }),
      ),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const client = AutomationClient.create({
    http: fake.http,
    url: CLIENT_URL,
    token: await token(),
  });
  return { client, asked: fake.asked, handed };
};

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("the automation server's calls to an automation client", () => {
  describe("/reserve", () => {
    it("posts each request as it is, with the bearer, to routes that hand it on, and answers reserved (happy)", async () => {
      const { client, asked, handed } = await served();
      const requests: ReadonlyArray<ClientRoutes.ReserveRequest> = [
        { job: JOB, action: "drive", iso: ISO, mode: "resume" },
        { job: JOB, action: "drive", iso: ISO, mode: "fresh" },
        { job: JOB, action: "setup", iso: ISO, server: QEMU_SERVER },
        { job: JOB, action: "diagnose" },
      ];

      const answers = [];
      for (const request of requests) {
        answers.push(await client.post("/reserve", request));
      }

      expect(answers).toEqual(requests.map(() => jarl.ok("reserved")));
      expect(asked).toEqual(requests.map((request) => posted("reserve", request)));
      expect(handed).toEqual(requests);
    });

    it("of a client at its --max-jobs answers at-capacity: no failure (unhappy)", async () => {
      const { client } = await served({ reserve: async () => "at-capacity" });

      const reserved = await client.post("/reserve", { job: JOB, action: "diagnose" });

      expect(reserved).toEqual(jarl.ok("at-capacity"));
    });

    it("of a resume no qemu server holds a setup disk for yet answers setup-needed: no failure (unhappy)", async () => {
      const { client } = await served({ reserve: async () => "setup-needed" });

      const reserved = await client.post("/reserve", {
        job: JOB,
        action: "drive",
        iso: ISO,
        mode: "resume",
      });

      expect(reserved).toEqual(jarl.ok("setup-needed"));
    });

    it("of a request the client's routes refuse does not compile, and those routes refuse it as HttpBadRequest (unhappy)", async () => {
      const { client, handed } = await served();

      // @ts-expect-error: a drive names its mode, as the automation client's schema says.
      const reserved = await client.post("/reserve", { job: JOB, action: "drive", iso: ISO });

      expect(Fake.failure(reserved, Http.HttpBadRequest).body).toBe(
        JSON.stringify({ error: "a reserve names its job and what it boots" }),
      );
      expect(handed).toEqual([]);
    });
  });

  describe("/run", () => {
    it("posts its job and prompt, and answers ended once the client answers, however long past the HTTP default that is (happy)", async () => {
      const { client, asked } = await served({
        run: () => later(DEFAULT_TIMEOUT_MS * 4, jarl.ok("ended" as const)),
      });

      const ran = await client.post("/run", { job: JOB, prompt: PROMPT });

      expect(ran).toEqual(jarl.ok("ended"));
      expect(asked).toEqual([posted("run", { job: JOB, prompt: PROMPT })]);
    });

    it("an abort ended answers aborted: no failure (unhappy)", async () => {
      const { client } = await served({ run: async () => jarl.ok("aborted") });

      const ran = await client.post("/run", { job: JOB, prompt: PROMPT });

      expect(ran).toEqual(jarl.ok("aborted"));
    });

    it("whose driver failed fails as HttpServerError naming the client's reason (unhappy)", async () => {
      const { client } = await served({
        run: async () =>
          jarl.err(new ClientRoutes.RunFailed("driver exited 1: OpenRouterUnreachable")),
      });

      const ran = await client.post("/run", { job: JOB, prompt: PROMPT });

      expect(Fake.failure(ran, Http.HttpServerError).body).toBe(
        JSON.stringify({ error: "driver exited 1: OpenRouterUnreachable" }),
      );
    });
  });

  describe("/abort", () => {
    it("posts its job and answers stopped (happy)", async () => {
      const { client, asked, handed } = await served();

      const stopped = await client.post("/abort", { job: JOB });

      expect(stopped).toEqual(jarl.ok("stopped"));
      expect(asked).toEqual([posted("abort", { job: JOB })]);
      expect(handed).toEqual([{ job: JOB }]);
    });

    it("of a job the client does not hold answers not-held: no failure (unhappy)", async () => {
      const { client } = await served({ abort: async () => "not-held" });

      const stopped = await client.post("/abort", { job: JOB });

      expect(stopped).toEqual(jarl.ok("not-held"));
    });
  });
});
