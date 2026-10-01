import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Proxy from "../src/proxy.ts";

const TOKEN = "oligarchy-token";
const PROXY = "http://127.0.0.1:42069";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const QEMU = "http://10.0.0.5:4000";
const NEVER = new AbortController().signal;

const proxied = (replies: Fake.Options["replies"]) => {
  const fake = Fake.http({ replies });
  const proxy = Proxy.create({ http: fake.http, url: PROXY, token: { reveal: () => TOKEN } });
  return { proxy, asked: fake.asked };
};

const posted = (path: string, body: unknown) => ({
  url: `${PROXY}/${path}`,
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  body,
});

describe("the qemu reverse proxy, as the automation client calls it", () => {
  describe("reserve", () => {
    it("posts the job with the bearer, naming the ISO a drive resumes or the server a setup is locked to, and a 200 is reserved (happy)", async () => {
      const { proxy, asked } = proxied(Fake.json({}));

      const answers = [
        await proxy.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER),
        await proxy.reserve({ jobId: JOB, action: "drive" }, NEVER),
        await proxy.reserve({ jobId: JOB, action: "setup", setupServer: QEMU }, NEVER),
      ];

      expect(answers).toEqual([jarl.ok("reserved"), jarl.ok("reserved"), jarl.ok("reserved")]);
      expect(asked).toEqual([
        posted("reserve", { job: JOB, resume: ISO }),
        posted("reserve", { job: JOB }),
        posted("reserve", { job: JOB, setupServer: QEMU }),
      ]);
    });

    it("a 503 is at-capacity and a 409 is setup-needed: refusals, not failures (unhappy)", async () => {
      const { proxy } = proxied([
        Fake.json({ error: "at capacity" }, 503),
        Fake.json({ error: "setup needed" }, 409),
      ]);

      const full = await proxy.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER);
      const unset = await proxy.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER);

      expect(full).toEqual(jarl.ok("at-capacity"));
      expect(unset).toEqual(jarl.ok("setup-needed"));
    });

    it("any other answer is the failure it came as (unhappy)", async () => {
      const { proxy } = proxied(Fake.json({ error: "DATABASE FAILURE" }, 500));

      const failed = await proxy.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER);

      expect(Fake.failure(failed, Http.HttpServerError).message).toBe(
        `POST ${PROXY}/reserve: 500: {"error":"DATABASE FAILURE"}`,
      );
    });
  });

  describe("relinquish", () => {
    it("posts the job with the bearer, and a 200 gave its guest back (happy)", async () => {
      const { proxy, asked } = proxied(Fake.json({}));

      const relinquished = await proxy.relinquish(JOB);

      expect(relinquished).toEqual(jarl.ok(undefined));
      expect(asked).toEqual([posted("relinquish", { job: JOB })]);
    });

    it("a 404 is a job the proxy holds no guest for, so there is nothing to give back (unhappy)", async () => {
      const { proxy } = proxied(Fake.json({ error: "job not found" }, 404));

      expect(await proxy.relinquish(JOB)).toEqual(jarl.ok(undefined));
    });

    it("any other answer is the failure it came as (unhappy)", async () => {
      const { proxy } = proxied(Fake.json({ error: "server down" }, 502));

      const failed = await proxy.relinquish(JOB);

      expect(Fake.failure(failed, Http.HttpServerError).message).toBe(
        `POST ${PROXY}/relinquish: 502: {"error":"server down"}`,
      );
    });
  });
});
