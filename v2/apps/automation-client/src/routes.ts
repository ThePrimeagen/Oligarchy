import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import * as z from "zod";

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

// Every route takes OLIGARCHY_TOKEN as its bearer. One chain, so `Routes` carries each route's
// request and every answer it can give, and the automation server's `hc<Routes>` is typed by it.
export const routes = (options: { readonly token: string }) =>
  new Hono()
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
      (c) => c.json({ error: "reserve is not written yet" }, 501),
    )
    .post(
      "/run",
      zValidator("json", RunRequest, (result, c) =>
        result.success ? undefined : c.json({ error: "name a jobId and a prompt" }, 400),
      ),
      (c) => c.json({ error: "run is not written yet" }, 501),
    )
    .post(
      "/abort",
      zValidator("json", AbortRequest, (result, c) =>
        result.success ? undefined : c.json({ error: "name a jobId" }, 400),
      ),
      (c) => c.json({ error: "abort is not written yet" }, 501),
    );

export type Routes = ReturnType<typeof routes>;
