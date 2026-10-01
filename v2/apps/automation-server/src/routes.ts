import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import * as z from "zod";

export const AbortRequest = z.union([
  z.strictObject({ jobId: z.uuid() }),
  z.strictObject({ suiteId: z.uuid() }),
]);
export type AbortRequest = z.infer<typeof AbortRequest>;

// Every route takes OLIGARCHY_TOKEN as its bearer. One chain, so `Routes` carries each route's
// request and every answer it can give, and a caller's `hc<Routes>` is typed by it.
export const routes = (options: { readonly token: string }) =>
  new Hono().use(bearerAuth({ token: options.token })).post(
    "/abort",
    zValidator("json", AbortRequest, (result, c) =>
      result.success ? undefined : c.json({ error: "name a jobId or a suiteId" }, 400),
    ),
    (c) => c.json({ error: "abort is not written yet" }, 501),
  );

export type Routes = ReturnType<typeof routes>;
