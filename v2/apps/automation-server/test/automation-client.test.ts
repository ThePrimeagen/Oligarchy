import { readFileSync } from "node:fs";
import * as Async from "@oligarchy/async";
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
const DEFAULT_TIMEOUT_MS = 5;

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

// The automation client's own routes behind the fake transport, over sessions answering as told,
// so each call is answered as that client answers it.
const served = (told: Partial<ClientRoutes.Sessions> = {}) => {
  const { sessions, handed } = FakeSessions.sessions(told);
  const routes = ClientRoutes.routes({ token: TOKEN, sessions });
  const replies = (asked: Fake.Asked) =>
    routes.fetch(
      new Request(asked.url, {
        method: asked.method,
        headers: asked.headers,
        body: JSON.stringify(asked.body),
      }),
    );
  return { replies, handed };
};

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

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("the automation server's calls to an automation client", () => {
  describe("reserve", () => {
    it("posts its request as it is, with the bearer, to routes that hand it on, and answers reserved (happy)", async () => {
      const { replies, handed } = served();
      const { client: at, asked } = await client(replies);
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
      expect(handed).toEqual(requests);
    });

    it("of a client at its --max-jobs answers at-capacity: no failure (unhappy)", async () => {
      const { replies } = served({ reserve: async () => "at-capacity" });
      const { client: at } = await client(replies);

      const reserved = await AutomationClient.reserve(at, { job: JOB, action: "diagnose" });

      expect(reserved).toEqual(jarl.ok("at-capacity"));
    });

    it("of a resume no qemu server holds a setup disk for yet answers setup-needed: no failure (unhappy)", async () => {
      const { replies } = served({ reserve: async () => "setup-needed" });
      const { client: at } = await client(replies);

      const reserved = await AutomationClient.reserve(at, {
        job: JOB,
        action: "drive",
        iso: ISO,
        mode: "resume",
      });

      expect(reserved).toEqual(jarl.ok("setup-needed"));
    });

    it("answered by any other 5xx fails as HttpServerError (unhappy)", async () => {
      const { replies } = served({
        reserve: async () => {
          throw new Error("proxy unreachable");
        },
      });
      const { client: at } = await client(replies);

      const reserved = await AutomationClient.reserve(at, { job: JOB, action: "diagnose" });

      expect(Fake.failure(reserved, Http.HttpServerError).status).toBe(500);
    });

    it("of a request the client's routes refuse does not compile, and those routes refuse it as HttpBadRequest (unhappy)", async () => {
      const { replies, handed } = served();
      const { client: at } = await client(replies);

      // @ts-expect-error: a drive names its mode, as the automation client's schema says.
      const reserved = await AutomationClient.reserve(at, { job: JOB, action: "drive", iso: ISO });

      expect(Fake.failure(reserved, Http.HttpBadRequest).body).toBe(
        JSON.stringify({ error: "a reserve names its job and what it boots" }),
      );
      expect(handed).toEqual([]);
    });
  });

  describe("run", () => {
    it("posts its job and prompt, and answers ended once the client answers, however long past the HTTP default that is (happy)", async () => {
      const { replies } = served({
        run: () => later(DEFAULT_TIMEOUT_MS * 10, jarl.ok("ended" as const)),
      });
      const { client: at, asked } = await client(replies);

      const ran = await AutomationClient.run(at, { job: JOB, prompt: PROMPT });

      expect(ran).toEqual(jarl.ok("ended"));
      expect(asked).toEqual([posted("run", { job: JOB, prompt: PROMPT })]);
    });

    it("an abort ended answers aborted: no failure (unhappy)", async () => {
      const { replies } = served({ run: async () => jarl.ok("aborted") });
      const { client: at } = await client(replies);

      const ran = await AutomationClient.run(at, { job: JOB, prompt: PROMPT });

      expect(ran).toEqual(jarl.ok("aborted"));
    });

    it("whose driver failed fails as HttpServerError naming the client's reason (unhappy)", async () => {
      const { replies } = served({
        run: async () =>
          jarl.err(new ClientRoutes.RunFailed("driver exited 1: OpenRouterUnreachable")),
      });
      const { client: at } = await client(replies);

      const ran = await AutomationClient.run(at, { job: JOB, prompt: PROMPT });

      expect(Fake.failure(ran, Http.HttpServerError).body).toBe(
        JSON.stringify({ error: "driver exited 1: OpenRouterUnreachable" }),
      );
    });

    it("ends its wait as Aborted when the client's signal aborts, as a shutdown does (unhappy)", async () => {
      const shutdown = new AbortController();
      const { client: at, asked } = await client("hang", { signal: shutdown.signal });

      const running = AutomationClient.run(at, { job: JOB, prompt: PROMPT });
      await later(DEFAULT_TIMEOUT_MS * 4, undefined);
      shutdown.abort(new Async.Aborted("shutting down"));

      Fake.failure(await running, Async.Aborted);
      expect(asked).toHaveLength(1);
    });
  });

  describe("abort", () => {
    it("posts its job and answers stopped (happy)", async () => {
      const { replies, handed } = served();
      const { client: at, asked } = await client(replies);

      const stopped = await AutomationClient.abort(at, { job: JOB });

      expect(stopped).toEqual(jarl.ok("stopped"));
      expect(asked).toEqual([posted("abort", { job: JOB })]);
      expect(handed).toEqual([{ job: JOB }]);
    });

    it("of a job the client does not hold answers not-held: no failure (unhappy)", async () => {
      const { replies } = served({ abort: async () => "not-held" });
      const { client: at } = await client(replies);

      const stopped = await AutomationClient.abort(at, { job: JOB });

      expect(stopped).toEqual(jarl.ok("not-held"));
    });
  });
});
