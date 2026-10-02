import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import * as jarl from "jarl";
import * as z from "zod";

// A drive may name the ISO whose setup disk it resumes; a setup names the qemu host its setup lock
// names. A reserve names one or neither, never both; each body rules out the other's key, so the
// types refuse both as the schema does.
export const ReserveRequest = z.union([
  z.strictObject({
    job: z.uuid(),
    resume: z.url().optional(),
    setupServer: z.never().optional(),
  }),
  z.strictObject({ job: z.uuid(), setupServer: z.url(), resume: z.never().optional() }),
]);
export type ReserveRequest = z.infer<typeof ReserveRequest>;

export const RelinquishRequest = z.strictObject({ job: z.uuid() });
export type RelinquishRequest = z.infer<typeof RelinquishRequest>;

// A refusal is no failure: every qemu host is full, or none with room holds the setup disk the
// drive resumes.
export type Reserved = "reserved" | "at-capacity" | "setup-needed";
// A job it holds no guest for has nothing to give back.
export type Relinquished = "relinquished" | "not-held";

// The reserve placed no guest; the message says why.
export const ReserveRefused = jarl.error.define("ReserveRefused");
export type ReserveRefused = InstanceType<typeof ReserveRefused>;

// The reserve failed once it may have placed a guest, so the caller gives it back; the message says
// why.
export const ReserveFailed = jarl.error.define("ReserveFailed");
export type ReserveFailed = InstanceType<typeof ReserveFailed>;

// The guest could not be given back; the message says why.
export const RelinquishFailed = jarl.error.define("RelinquishFailed");
export type RelinquishFailed = InstanceType<typeof RelinquishFailed>;

// What the routes hand each request to.
export type Router = {
  readonly reserve: (
    request: ReserveRequest,
  ) => Promise<jarl.Result<Reserved, ReserveRefused | ReserveFailed>>;
  readonly relinquish: (
    request: RelinquishRequest,
  ) => Promise<jarl.Result<Relinquished, RelinquishFailed>>;
};

// Every route takes OLIGARCHY_TOKEN as its bearer. One chain, so `Routes` carries each route's
// request and every answer it can give, and the automation client's calls are typed by it. A
// route whose router function is not handed in yet answers 501 until its task is written.
export const routes = (options: { readonly token: string; readonly router?: Partial<Router> }) => {
  const { reserve, relinquish } = options.router ?? {};
  return new Hono()
    .use(bearerAuth({ token: options.token }))
    .post(
      "/reserve",
      zValidator("json", ReserveRequest, (result, c) =>
        result.success
          ? undefined
          : c.json(
              { error: "name a job: a drive may name resume, a setup names setupServer" },
              400,
            ),
      ),
      async (c) => {
        if (reserve === undefined) {
          return c.json({ error: "reserve is not written yet" }, 501);
        }
        const reserved = await reserve(c.req.valid("json"));
        if (jarl.error.is(reserved, ReserveRefused)) {
          return c.json({ error: reserved.error.message }, 400);
        }
        if (jarl.is_err(reserved)) {
          return c.json({ error: reserved.error.message }, 500);
        }
        const word = jarl.value(reserved);
        if (word === "at-capacity") {
          return c.json({ error: "at capacity" }, 503);
        }
        if (word === "setup-needed") {
          return c.json({ error: "setup needed" }, 409);
        }
        return c.json({}, 200);
      },
    )
    .post(
      "/relinquish",
      zValidator("json", RelinquishRequest, (result, c) =>
        result.success ? undefined : c.json({ error: "name a job" }, 400),
      ),
      async (c) => {
        if (relinquish === undefined) {
          return c.json({ error: "relinquish is not written yet" }, 501);
        }
        const relinquished = await relinquish(c.req.valid("json"));
        if (jarl.is_err(relinquished)) {
          return c.json({ error: relinquished.error.message }, 500);
        }
        if (jarl.value(relinquished) === "not-held") {
          return c.json({ error: "job not found" }, 404);
        }
        return c.json({}, 200);
      },
    );
};

export type Routes = ReturnType<typeof routes>;
