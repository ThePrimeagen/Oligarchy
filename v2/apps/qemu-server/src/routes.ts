import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";

export const AbortRequest = z.strictObject({ job: z.uuid() });
export type AbortRequest = z.infer<typeof AbortRequest>;

export const routes = () =>
  new Hono().post(
    "/abort",
    zValidator("json", AbortRequest, (result, c) =>
      result.success ? undefined : c.json({ error: "name a job" }, 400),
    ),
    (c) => c.json({ error: "abort is not written yet" }, 501),
  );

export type Routes = ReturnType<typeof routes>;
