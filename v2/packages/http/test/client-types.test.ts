// Type checks only: check:types fails when one breaks. Nothing here sends a request.
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type * as jarl from "jarl";
import { describe, expectTypeOf, it } from "vitest";
import * as z from "zod";
import * as HttpClient from "../src/client.ts";
import type * as Http from "../src/main.ts";
import * as Fake from "../src/testing.ts";

const routes = () =>
  new Hono()
    .post("/start", zValidator("json", z.strictObject({ job: z.string() })), async (c) =>
      c.req.valid("json").job === "" ? c.json({ error: "busy" }, 503) : c.json({}, 200),
    )
    .post("/stop", zValidator("json", z.strictObject({ job: z.string() })), (c) => c.json({}, 200));
type Routes = ReturnType<typeof routes>;

const withGet = () => routes().get("/stats", (c) => c.json({ jobs: 0 }, 200));
type WithGet = ReturnType<typeof withGet>;

const { http } = Fake.http({ replies: Fake.json({}) });
const options: HttpClient.Options = {
  http,
  url: "http://10.0.0.7:4100",
  token: { reveal: () => "" },
};

describe("a client typed by an app's routes", () => {
  it("answers each route with the words its spec names, and takes each body as its route does (happy)", () => {
    const client = HttpClient.create<Routes>()(options, {
      "/start": { ok: "started", 503: "busy" },
      "/stop": { ok: "stopped" },
    });

    expectTypeOf(client.post("/start", { job: "j" })).toEqualTypeOf<
      Promise<jarl.Result<"started" | "busy", Http.HttpFailure>>
    >();
    expectTypeOf(client.post("/stop", { job: "j" })).toEqualTypeOf<
      Promise<jarl.Result<"stopped", Http.HttpFailure>>
    >();
  });

  it("refuses a spec that leaves out a route, names one the routes lack, or names a status its route never answers (unhappy)", () => {
    // @ts-expect-error every route needs its spec, so a route added to the app is one to answer
    HttpClient.create<Routes>()(options, { "/start": { ok: "started" } });
    HttpClient.create<Routes>()(options, {
      "/start": { ok: "started" },
      "/stop": { ok: "stopped" },
      // @ts-expect-error the routes have no /pause
      "/pause": { ok: "paused" },
    });
    HttpClient.create<Routes>()(options, {
      // @ts-expect-error /start never answers 418
      "/start": { ok: "started", 418: "teapot" },
      "/stop": { ok: "stopped" },
    });
    HttpClient.create<WithGet>()(options, {
      "/start": { ok: "started" },
      "/stop": { ok: "stopped" },
      // @ts-expect-error a route with no POST cannot be called
      "/stats": { ok: "counted" },
    });
  });

  it("refuses a path the routes lack and a body its route refuses (unhappy)", () => {
    const client = HttpClient.create<Routes>()(options, {
      "/start": { ok: "started" },
      "/stop": { ok: "stopped" },
    });

    // @ts-expect-error the routes have no /pause
    void (() => client.post("/pause", { job: "j" }));
    // @ts-expect-error /start takes a job, never a ticket
    void (() => client.post("/start", { ticket: "OLI-1" }));
  });
});
