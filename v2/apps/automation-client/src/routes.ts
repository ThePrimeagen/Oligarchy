import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import * as jarl from "jarl";
import * as z from "zod";

// What a reserve holds this client's slot for. A drive and a setup take a guest on the proxy too:
// a drive boots its ISO from that ISO's setup disk when it resumes and fresh otherwise, and a
// setup boots fresh on the qemu server its setup lock names. A diagnose takes no guest.
export const ReserveRequest = z.discriminatedUnion("action", [
  z.strictObject({ job: z.uuid(), action: z.literal("diagnose") }),
  z.strictObject({
    job: z.uuid(),
    action: z.literal("drive"),
    iso: z.url(),
    mode: z.enum(["resume", "fresh"]),
  }),
  z.strictObject({ job: z.uuid(), action: z.literal("setup"), iso: z.url(), server: z.url() }),
]);
export type ReserveRequest = z.infer<typeof ReserveRequest>;

export const RunRequest = z.strictObject({ job: z.uuid(), prompt: z.string().min(1) });
export type RunRequest = z.infer<typeof RunRequest>;

export const AbortRequest = z.strictObject({ job: z.uuid() });
export type AbortRequest = z.infer<typeof AbortRequest>;

// A refusal is no failure: the job stays pending and is asked for again.
export type Reserved = "reserved" | "at-capacity" | "setup-needed";
// The driver or opencode ran to its end, or an abort ended it.
export type Ran = "ended" | "aborted";
// A client that does not hold the job has nothing to stop.
export type Stopped = "stopped" | "not-held";

// The driver or opencode could not run the job to its end; the message says why.
export const RunFailed = jarl.error.define("RunFailed");
export type RunFailed = InstanceType<typeof RunFailed>;

// What the routes hand each request to. A run answers once the driver or opencode has ended.
export type Sessions = {
  readonly reserve: (request: ReserveRequest) => Promise<Reserved>;
  readonly run: (request: RunRequest) => Promise<jarl.Result<Ran, RunFailed>>;
  readonly abort: (request: AbortRequest) => Promise<Stopped>;
};

const refusing = (error: string) => (result: { readonly success: boolean }, c: Context) =>
  result.success ? undefined : c.json({ error }, 400);

// Every route takes OLIGARCHY_TOKEN as its bearer. One chain, so `Routes` carries each route's
// request and every answer it can give, and the automation server's calls are typed by it.
export const routes = (options: { readonly token: string; readonly sessions: Sessions }) => {
  const { sessions } = options;
  return new Hono()
    .use(bearerAuth({ token: options.token }))
    .post(
      "/reserve",
      zValidator("json", ReserveRequest, refusing("a reserve names its job and what it boots")),
      async (c) => {
        const reserved = await sessions.reserve(c.req.valid("json"));
        if (reserved === "at-capacity") {
          return c.json({ error: "at capacity" }, 503);
        }
        if (reserved === "setup-needed") {
          return c.json({ error: "setup needed" }, 409);
        }
        return c.json({}, 200);
      },
    )
    .post(
      "/run",
      zValidator("json", RunRequest, refusing("a run names its job and prompt")),
      async (c) => {
        const ran = await sessions.run(c.req.valid("json"));
        if (jarl.is_err(ran)) {
          return c.json({ error: ran.error.message }, 500);
        }
        if (jarl.value(ran) === "aborted") {
          return c.json({ error: "aborted" }, 409);
        }
        return c.json({}, 200);
      },
    )
    .post(
      "/abort",
      zValidator("json", AbortRequest, refusing("an abort names its job")),
      async (c) => {
        const stopped = await sessions.abort(c.req.valid("json"));
        if (stopped === "not-held") {
          return c.json({ error: "job not found" }, 404);
        }
        return c.json({}, 200);
      },
    );
};

export type Routes = ReturnType<typeof routes>;
