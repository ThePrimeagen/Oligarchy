import { zValidator } from "@hono/zod-validator";
import * as Async from "@oligarchy/async";
import { Hono } from "hono";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import * as HttpClient from "../src/client.ts";
import * as Http from "../src/main.ts";
import * as Fake from "../src/testing.ts";

const TOKEN = "oligarchy-s3cret";
// A client's url as its row names it: with a path of its own and a trailing slash.
const URL_OF_CLIENT = "https://clients.example/v2/";
const DEFAULT_TIMEOUT_MS = 5;

// Routes as an app exports them; only their type reaches the client.
const routes = () =>
  new Hono()
    .post("/jobs/start", zValidator("json", z.strictObject({ job: z.string() })), async (c) => {
      const { job } = c.req.valid("json");
      if (job === "busy") {
        return c.json({ error: "busy" }, 503);
      }
      if (job === "taken") {
        return c.json({ error: "taken" }, 409);
      }
      if (job === "gone") {
        return c.json({ error: "gone" }, 404);
      }
      return c.json({}, 200);
    })
    .post("/jobs/wait", zValidator("json", z.strictObject({ job: z.string() })), (c) =>
      c.json({}, 200),
    );
type Routes = ReturnType<typeof routes>;

const make = (
  replies: Fake.Options["replies"],
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
) => {
  const fake = Fake.http({ replies, timeoutMs: DEFAULT_TIMEOUT_MS });
  const client = HttpClient.create<Routes>()(
    {
      http: fake.http,
      url: URL_OF_CLIENT,
      token: { reveal: () => TOKEN },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    {
      "/jobs/start": { ok: "started", 400: "refused", 404: "gone", 409: "taken", 503: "busy" },
      "/jobs/wait": {
        ok: "waited",
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    },
  );
  return { client, asked: fake.asked };
};

const later = (ms: number, reply: Response): Promise<Response> =>
  new Promise((resolve) => setTimeout(() => resolve(reply), ms));

describe("a client typed by an app's routes", () => {
  it("posts the body as it is to the client's url joined with the route's path, with the bearer, and answers the route's ok word (happy)", async () => {
    const { client, asked } = make(Fake.json({}));

    const started = await client.post("/jobs/start", { job: "j-1" });

    expect(started).toEqual(jarl.ok("started"));
    expect(asked).toEqual([
      {
        url: "https://clients.example/v2/jobs/start",
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: { job: "j-1" },
      },
    ]);
  });

  it.each([
    { status: 400, word: "refused" },
    { status: 404, word: "gone" },
    { status: 409, word: "taken" },
    { status: 503, word: "busy" },
  ])(
    "answers $status, a status the route's spec names, with its word: no failure (unhappy)",
    async ({ status, word }) => {
      const { client } = make(Fake.json({ error: word }, status));

      const answered = await client.post("/jobs/start", { job: "j-1" });

      expect(answered).toEqual(jarl.ok(word));
    },
  );

  it("fails a status the route's spec does not name with @oligarchy/http's own error (unhappy)", async () => {
    const { client } = make([
      Fake.json({ error: "internal" }, 500),
      Fake.status(401, "Unauthorized"),
    ]);

    const failed = await client.post("/jobs/start", { job: "j-1" });
    const refused = await client.post("/jobs/start", { job: "j-1" });

    expect(Fake.failure(failed, Http.HttpServerError).status).toBe(500);
    expect(Fake.failure(refused, Http.HttpUnhandled).status).toBe(401);
  });

  it("waits a route's own timeoutMs in place of the default, which times a route without one out (unhappy)", async () => {
    const slow = () => later(DEFAULT_TIMEOUT_MS * 10, Fake.json({}));
    const patient = make(slow, { timeoutMs: DEFAULT_TIMEOUT_MS * 100 });
    const impatient = make(slow);

    const waited = await patient.client.post("/jobs/wait", { job: "j-1" });
    const timedOut = await impatient.client.post("/jobs/wait", { job: "j-1" });

    expect(waited).toEqual(jarl.ok("waited"));
    Fake.failure(timedOut, Http.HttpTimedOut);
  });

  it("ends a call in flight as Aborted when the client's signal aborts (unhappy)", async () => {
    const shutdown = new AbortController();
    const { client, asked } = make("hang", {
      signal: shutdown.signal,
      timeoutMs: DEFAULT_TIMEOUT_MS * 100,
    });

    const waiting = client.post("/jobs/wait", { job: "j-1" });
    await later(DEFAULT_TIMEOUT_MS * 4, Fake.json({}));
    shutdown.abort(new Async.Aborted("shutting down"));

    Fake.failure(await waiting, Async.Aborted);
    expect(asked).toHaveLength(1);
  });
});
