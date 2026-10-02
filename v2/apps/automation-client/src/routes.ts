import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import * as jarl from "jarl";
import * as z from "zod";
import * as Jobs from "./jobs.ts";

// A drive may name the ISO it resumes; a setup names the qemu server its setup lock names; a
// diagnose names neither. Each action's body is strict, so a key another action takes is refused.
export const ReserveRequest = z.discriminatedUnion("action", [
  z.strictObject({ jobId: z.uuid(), action: z.literal("drive"), resume: z.url().optional() }),
  z.strictObject({ jobId: z.uuid(), action: z.literal("setup"), setupServer: z.url() }),
  z.strictObject({ jobId: z.uuid(), action: z.literal("diagnose") }),
]);
export type ReserveRequest = z.infer<typeof ReserveRequest>;

export const RunRequest = z.strictObject({ jobId: z.uuid(), prompt: z.string().min(1) });
export type RunRequest = z.infer<typeof RunRequest>;

export const AbortRequest = z.strictObject({ jobId: z.uuid() });
export type AbortRequest = z.infer<typeof AbortRequest>;

// The driver or opencode ran to its end, or an abort ended it.
export type Ran = "ended" | "aborted";
// A client that does not hold the job has nothing to stop.
export type Stopped = "stopped" | "not-held";

// The client is at --max-jobs or already asking the proxy for another guest, or the proxy has no
// room; the message says which. The job stays pending and is asked for again.
export const AtCapacity = jarl.error.define("AtCapacity");
export type AtCapacity = InstanceType<typeof AtCapacity>;

// No qemu server with room holds the setup disk the drive resumes; the message says what the proxy
// said. The job stays pending until a setup lands.
export const SetupNeeded = jarl.error.define("SetupNeeded");
export type SetupNeeded = InstanceType<typeof SetupNeeded>;

// The qemu reverse proxy could not reserve the job's guest; the message says why.
export const ReserveFailed = jarl.error.define("ReserveFailed");
export type ReserveFailed = InstanceType<typeof ReserveFailed>;

// The driver or opencode could not run the job to its end; the message says why.
export const RunFailed = jarl.error.define("RunFailed");
export type RunFailed = InstanceType<typeof RunFailed>;

// What the routes hand each request to. A run answers once the driver or opencode has ended.
export type Sessions = {
  readonly reserve: (
    request: ReserveRequest,
  ) => Promise<
    jarl.Result<
      void,
      AtCapacity | SetupNeeded | Jobs.AlreadyHeld | Jobs.ShuttingDown | ReserveFailed
    >
  >;
  readonly run: (request: RunRequest) => Promise<jarl.Result<Ran, RunFailed>>;
  readonly abort: (request: AbortRequest) => Promise<Stopped>;
};

// Every route takes OLIGARCHY_TOKEN as its bearer. One chain, so `Routes` carries each route's
// request and every answer it can give, and the automation server's client is typed by it. A
// route whose session is not handed in yet answers 501 until its task is written.
export const routes = (options: {
  readonly token: string;
  readonly sessions?: Partial<Sessions>;
}) => {
  const { reserve, run, abort } = options.sessions ?? {};
  return new Hono()
    .use(bearerAuth({ token: options.token }))
    .post(
      "/reserve",
      zValidator("json", ReserveRequest, (result, c) =>
        result.success
          ? undefined
          : c.json(
              {
                error:
                  "name a jobId and an action: a drive may name resume, a setup names setupServer",
              },
              400,
            ),
      ),
      async (c) => {
        if (reserve === undefined) {
          return c.json({ error: "reserve is not written yet" }, 501);
        }
        const reserved = await reserve(c.req.valid("json"));
        if (jarl.error.is(reserved, AtCapacity)) {
          return c.json({ error: reserved.error.message }, 503);
        }
        if (jarl.error.is(reserved, Jobs.ShuttingDown)) {
          return c.json({ error: reserved.error.message }, 503);
        }
        if (jarl.error.is(reserved, SetupNeeded)) {
          return c.json({ error: reserved.error.message }, 409);
        }
        if (jarl.error.is(reserved, Jobs.AlreadyHeld)) {
          return c.json({ error: reserved.error.message }, 400);
        }
        if (jarl.is_err(reserved)) {
          return c.json({ error: reserved.error.message }, 500);
        }
        return c.json({}, 200);
      },
    )
    .post(
      "/run",
      zValidator("json", RunRequest, (result, c) =>
        result.success ? undefined : c.json({ error: "name a jobId and a prompt" }, 400),
      ),
      async (c) => {
        if (run === undefined) {
          return c.json({ error: "run is not written yet" }, 501);
        }
        const ran = await run(c.req.valid("json"));
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
      zValidator("json", AbortRequest, (result, c) =>
        result.success ? undefined : c.json({ error: "name a jobId" }, 400),
      ),
      async (c) => {
        if (abort === undefined) {
          return c.json({ error: "abort is not written yet" }, 501);
        }
        const stopped = await abort(c.req.valid("json"));
        if (stopped === "not-held") {
          return c.json({ error: "job not found" }, 404);
        }
        return c.json({}, 200);
      },
    );
};

export type Routes = ReturnType<typeof routes>;
