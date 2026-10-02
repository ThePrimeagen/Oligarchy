import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http/testing";
import * as Store from "@oligarchy/stores/testing";
import * as Logger from "@oligarchy/logger/testing";
import * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Router from "../src/router.ts";
import { routes } from "../src/routes.ts";
import configFile from "../../../oligarchy.json";
const JOB = "11111111-1111-4111-8111-111111111111";
const never = new AbortController().signal;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const setup = async (
  replies: Http.Options["replies"],
  options: {
    assigned?: string;
    writeFail?: boolean;
    committed?: boolean;
    stats?: Record<string, { jobs: number; available: number }>;
  } = {},
) => {
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "test", description: "" }).done(),
      Env.fakeIo({ files: { [Env.CONFIG_PATH]: JSON.stringify(configFile) } }),
    ),
  );
  let next = 0;
  const http = Http.http({
    replies: (asked) => {
      const url = new URL(asked.url);
      if (url.pathname === "/stats")
        return Http.json(options.stats?.[url.origin] ?? { jobs: 0, available: 1 });
      if (typeof replies === "function") return replies(asked);
      if (typeof replies === "string" || replies instanceof Response) return replies;
      return replies[next++] ?? "unreachable";
    },
  });
  let assignment = options.assigned;
  const routeJob = vi.fn(async (_job: string, url: string) => {
    if (!options.writeFail || options.committed) assignment = url;
    return options.writeFail ? jarl.err(new Db.DatabaseError("write failed")) : jarl.ok(undefined);
  });
  const ensureSetup = vi.fn(async () => jarl.ok(undefined));
  const services = {
    http: http.http,
    logger: Logger.logger().logger,
    servers: Store.servers({
      serverForJob: async () => jarl.ok(assignment),
      routeJob,
      listServers: async () => jarl.ok(["http://runner1", "http://runner2"]),
    }),
    tests: Store.tests({ ensureSetup }),
    setupRequests: Store.setupRequests({}),
  };
  const router = Router.create(services, {
    token: { reveal: () => "token" },
    url: "http://proxy",
    config: env.config,
  });
  return {
    router,
    services,
    routeJob,
    ensureSetup,
    config: env.config,
    get asked() {
      return http.asked.filter((call) => new URL(call.url).pathname !== "/stats");
    },
    get probes() {
      return http.asked.filter((call) => new URL(call.url).pathname === "/stats");
    },
  };
};
it("places once and forwards binary responses with metadata", async () => {
  const h = await setup([
    Http.json({}),
    new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "image/png", "x-image-id": "picture" },
    }),
  ]);
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(200);
  const image = await h.router.handle("image", { job: JOB }, never);
  expect(image.headers.get("x-image-id")).toBe("picture");
  expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2]);
  expect(h.routeJob).toHaveBeenCalledOnce();
});
it("reuses the stored assignment without inserting a second route", async () => {
  const h = await setup(Http.json({}), { assigned: "http://runner2" });
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(200);
  expect(h.asked[0]?.url).toBe("http://runner2/reserve");
  expect(h.routeJob).not.toHaveBeenCalled();
});
it("tries the next runner only after a definite capacity refusal", async () => {
  const h = await setup([Http.json({}, 503), Http.json({})]);
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(200);
  expect(h.asked.map((a) => a.url)).toEqual(["http://runner1/reserve", "http://runner2/reserve"]);
});
it("a pinned setup does not fall back", async () => {
  const h = await setup(Http.json({}, 503));
  const response = await h.router.handle(
    "reserve",
    { job: JOB, setupServer: "http://runner2" },
    never,
  );
  expect(response.status).toBe(503);
  await response.body?.cancel();
  expect(h.asked).toHaveLength(1);
});
it("missing setup disks schedule through the atomic existing-store operation", async () => {
  const h = await setup(Http.json({ available: false }));
  expect((await h.router.handle("reserve", { job: JOB, resume: "iso" }, never)).status).toBe(409);
  expect(h.ensureSetup.mock.calls).toHaveLength(2);
  expect(h.routeJob).not.toHaveBeenCalled();
});
it("a lost route acknowledgement is read back before compensating", async () => {
  const h = await setup(Http.json({}), { writeFail: true, committed: true });
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(200);
  expect(h.asked).toHaveLength(1);
});
it("a failed route write relinquishes the accepted slot", async () => {
  const h = await setup(Http.json({}), { writeFail: true });
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(500);
  expect(h.asked.map((a) => new URL(a.url).pathname)).toEqual(["/reserve", "/relinquish"]);
});
it("ambiguous reserve failure is cleaned up without placing on another runner", async () => {
  const h = await setup(["unreachable", Http.json({})]);
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(502);
  expect(h.asked).toHaveLength(2);
  expect(h.asked[1]?.url).toBe("http://runner1/relinquish");
});
it("start uses its long deadline instead of the default HTTP deadline", async () => {
  let answer!: (value: Response) => void;
  const h = await setup(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
    { assigned: "http://runner1" },
  );
  let done = false;
  const started = h.router
    .handle("start", { job: JOB, iso: "iso", mode: "fresh" }, never)
    .then((result) => {
      done = true;
      return result;
    });
  await vi.advanceTimersByTimeAsync(h.config.httpTimeout + 1);
  expect(done).toBe(false);
  answer(Http.json({}));
  const response = await started;
  expect(response.status).toBe(200);
  await response.body?.cancel();
});
it("all endpoints authenticate and reject invalid jobs before handling", async () => {
  const h = await setup(Http.json({}));
  const app = routes({
    token: "token",
    handle: h.router.handle,
    register: h.router.register,
    servers: h.services.servers,
  });
  expect((await app.request("/stats")).status).toBe(401);
  expect(
    (
      await app.request("/reserve", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: '{"job":"bad"}',
      })
    ).status,
  ).toBe(400);
  expect(h.asked).toHaveLength(0);
});

it("ranks answering runners by load and skips full runners", async () => {
  const h = await setup(Http.json({}), {
    stats: {
      "http://runner1": { jobs: 3, available: 1 },
      "http://runner2": { jobs: 0, available: 1 },
    },
  });
  expect((await h.router.handle("reserve", { job: JOB }, never)).status).toBe(200);
  expect(h.probes).toHaveLength(2);
  expect(h.asked[0]?.url).toBe("http://runner2/reserve");
});
