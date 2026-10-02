import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as QemuRoutes from "@oligarchy/qemu-server/routes";
import * as FakeRouter from "@oligarchy/qemu-server/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as QemuServer from "../src/qemu-server.ts";

const TOKEN = "oligarchy-token";
const QEMU_SERVER = "http://127.0.0.1:42069";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const HOST = "http://10.0.0.5:4000";
const NEVER = new AbortController().signal;

const posted = (path: string, body: unknown): Fake.Asked => ({
  url: `${QEMU_SERVER}/${path}`,
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  body,
});

// The qemu server at QEMU_SERVER: its own routes behind the fake transport, over a router
// answering as told, so each call is answered as that server answers it.
const served = (told: Partial<QemuRoutes.Router> = {}) => {
  const { router, handed } = FakeRouter.router(told);
  const routes = QemuRoutes.routes({ token: TOKEN, router });
  const fake = Fake.http({
    replies: (asked) =>
      routes.fetch(
        new Request(asked.url, {
          method: asked.method,
          headers: asked.headers,
          body: JSON.stringify(asked.body),
        }),
      ),
  });
  const qemuServer = QemuServer.create({
    http: fake.http,
    url: QEMU_SERVER,
    token: { reveal: () => TOKEN },
  });
  return { qemuServer, asked: fake.asked, handed };
};

describe("the qemu server, as the automation client calls it", () => {
  describe("reserve", () => {
    it("posts the job with the bearer, naming the ISO a drive resumes or the host a setup is locked to, and the router's reserved is reserved (happy)", async () => {
      const { qemuServer, asked, handed } = served();
      const bodies = [{ job: JOB, resume: ISO }, { job: JOB }, { job: JOB, setupServer: HOST }];

      const answers = [
        await qemuServer.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER),
        await qemuServer.reserve({ jobId: JOB, action: "drive" }, NEVER),
        await qemuServer.reserve({ jobId: JOB, action: "setup", setupServer: HOST }, NEVER),
      ];

      expect(answers).toEqual([jarl.ok("reserved"), jarl.ok("reserved"), jarl.ok("reserved")]);
      expect(asked).toEqual(bodies.map((body) => posted("reserve", body)));
      expect(handed).toEqual(bodies);
    });

    it("at capacity and setup needed are refusals, not failures (unhappy)", async () => {
      const full = served({ reserve: async () => jarl.ok("at-capacity") }).qemuServer;
      const unset = served({ reserve: async () => jarl.ok("setup-needed") }).qemuServer;

      const answers = [
        await full.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER),
        await unset.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER),
      ];

      expect(answers).toEqual([jarl.ok("at-capacity"), jarl.ok("setup-needed")]);
    });

    it("a reserve that placed no guest is the HttpBadRequest naming why (unhappy)", async () => {
      const { qemuServer } = served({
        reserve: async () => jarl.err(new QemuRoutes.ReserveRefused(`no qemu host ${HOST}`)),
      });

      const failed = await qemuServer.reserve(
        { jobId: JOB, action: "setup", setupServer: HOST },
        NEVER,
      );

      expect(Fake.failure(failed, Http.HttpBadRequest).body).toBe(
        JSON.stringify({ error: `no qemu host ${HOST}` }),
      );
    });

    it("a reserve that failed once it may have placed a guest is the HttpServerError naming why (unhappy)", async () => {
      const { qemuServer } = served({
        reserve: async () => jarl.err(new QemuRoutes.ReserveFailed("DATABASE FAILURE")),
      });

      const failed = await qemuServer.reserve({ jobId: JOB, action: "drive", resume: ISO }, NEVER);

      expect(Fake.failure(failed, Http.HttpServerError).message).toBe(
        `POST ${QEMU_SERVER}/reserve: 500: {"error":"DATABASE FAILURE"}`,
      );
    });
  });

  describe("relinquish", () => {
    it("posts the job with the bearer, and the router's relinquished gave its guest back (happy)", async () => {
      const { qemuServer, asked, handed } = served();

      const relinquished = await qemuServer.relinquish(JOB);

      expect(relinquished).toEqual(jarl.ok(undefined));
      expect(asked).toEqual([posted("relinquish", { job: JOB })]);
      expect(handed).toEqual([{ job: JOB }]);
    });

    it("a job the server holds no guest for has nothing to give back (unhappy)", async () => {
      const { qemuServer } = served({ relinquish: async () => jarl.ok("not-held") });

      expect(await qemuServer.relinquish(JOB)).toEqual(jarl.ok(undefined));
    });

    it("a relinquish that failed is the HttpServerError naming why (unhappy)", async () => {
      const { qemuServer } = served({
        relinquish: async () =>
          jarl.err(new QemuRoutes.RelinquishFailed(`qemu host ${HOST} unreachable`)),
      });

      const failed = await qemuServer.relinquish(JOB);

      expect(Fake.failure(failed, Http.HttpServerError).message).toBe(
        `POST ${QEMU_SERVER}/relinquish: 500: {"error":"qemu host ${HOST} unreachable"}`,
      );
    });
  });
});
