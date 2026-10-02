import { zValidator } from "@hono/zod-validator";
import * as Stores from "@oligarchy/stores";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import * as jarl from "jarl";
import * as z from "zod";
import * as Abort from "./abort.ts";

// One job, or one whole suite, never both: a job filed on its own has no suite. Each side names
// the other's key as never, so the typed client refuses both as the server does.
export const AbortRequest = z.union([
  z.strictObject({ jobId: z.uuid(), suiteId: z.never().optional() }),
  z.strictObject({ suiteId: z.uuid(), jobId: z.never().optional() }),
]);
export type AbortRequest = z.infer<typeof AbortRequest>;

// Every route takes OLIGARCHY_TOKEN as its bearer. One chain, so `Routes` carries each route's
// request and every answer it can give, and a caller's `hc<Routes>` is typed by it. An abort is
// 200 once written, 404 for a job or suite there is none of, 409 for one already ended, 502 for a
// running job its client could not be asked to stop, and 500 when the database failed it.
export const routes = (options: {
  readonly token: string;
  readonly abort: Abort.Aborter["abort"];
}) =>
  new Hono().use(bearerAuth({ token: options.token })).post(
    "/abort",
    zValidator("json", AbortRequest, (result, c) =>
      result.success ? undefined : c.json({ error: "name a jobId or a suiteId" }, 400),
    ),
    async (c) => {
      const aborted = await options.abort(c.req.valid("json"));
      if (jarl.error.is(aborted, Stores.Tests.NotFound)) {
        return c.json({ error: aborted.error.message }, 404);
      }
      if (jarl.error.is(aborted, Abort.NothingToAbort)) {
        return c.json({ error: aborted.error.message }, 409);
      }
      if (jarl.error.is(aborted, Abort.NotStopped)) {
        return c.json({ error: aborted.error.message }, 502);
      }
      if (jarl.is_err(aborted)) {
        return c.json({ error: aborted.error.message }, 500);
      }
      return c.json({}, 200);
    },
  );

export type Routes = ReturnType<typeof routes>;
