import { routes as guestRoutes, type Handler } from "@oligarchy/qemu/routes";
import type * as Stores from "@oligarchy/stores";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import * as jarl from "jarl";
export const AbortRequest = z.strictObject({ job: z.uuid() });
export type AbortRequest = z.infer<typeof AbortRequest>;
export const routes = (options: {
  token: string;
  handle: Handler;
  servers: Stores.Servers.Servers;
  register: (url: string, signal: AbortSignal) => Promise<Response>;
}) =>
  guestRoutes(options)
    .get("/servers", async (c) => {
      const result = await options.servers.listServers("qemu");
      return jarl.is_err(result)
        ? c.json({ error: result.error.message }, 500)
        : c.json(jarl.value(result));
    })
    .post("/servers", zValidator("json", z.strictObject({ url: z.url() })), (c) =>
      options.register(c.req.valid("json").url, c.req.raw.signal),
    )
    .delete("/servers", zValidator("json", z.strictObject({ url: z.url() })), async (c) => {
      const result = await options.servers.removeServer(c.req.valid("json").url);
      return jarl.is_err(result)
        ? c.json({ error: result.error.message }, 500)
        : c.json({ removed: jarl.value(result) });
    });
export type Routes = ReturnType<typeof routes>;
