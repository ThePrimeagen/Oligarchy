import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";

const Job = z.strictObject({ job: z.uuid() });
export const Reserve = Job.extend({
  resume: z.string().min(1).optional(),
  setupServer: z.url().optional(),
});
export const Start = Job.extend({ iso: z.string().min(1), mode: z.enum(["fresh", "resume"]) });
const Point = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const Button = z.enum(["left", "middle", "right"]);
const Modifiers = z
  .array(z.enum(["shift", "ctrl", "alt", "super"]))
  .max(4)
  .optional();
const Move = Job.extend(Point.shape);
const Press = Move.extend({ button: Button, modifiers: Modifiers });
const Drag = Job.extend({ from: Point, to: Point, button: Button, modifiers: Modifiers });
const Scroll = Move.extend({
  direction: z.enum(["up", "down", "left", "right"]),
  ticks: z.int().positive(),
});
const Stop = Job.extend({
  status: z.enum(["succeeded", "failed", "aborted", "completed"]),
  reason: z.string().optional(),
});
const Keys = Job.extend({ keys: z.string().min(1) });
const Intent = Job.extend({ message: z.string().min(1) });
const Disk = z.strictObject({ iso: z.string().min(1) });
export type Requests = {
  reserve: z.infer<typeof Reserve>;
  start: z.infer<typeof Start>;
  stop: z.infer<typeof Stop>;
  relinquish: z.infer<typeof Job>;
  abort: z.infer<typeof Job>;
  save: z.infer<typeof Job>;
  image: z.infer<typeof Job>;
  serial: z.infer<typeof Job>;
  follow: z.infer<typeof Job>;
  "send-keys": z.infer<typeof Keys>;
  "intent/start": z.infer<typeof Intent>;
  "intent/end": z.infer<typeof Job>;
  "mouse/move": z.infer<typeof Move>;
  "mouse/click": z.infer<typeof Press>;
  "mouse/double-click": z.infer<typeof Press>;
  "mouse/drag": z.infer<typeof Drag>;
  "mouse/scroll": z.infer<typeof Scroll>;
  "mouse/hold": z.infer<typeof Press>;
  "mouse/release": z.infer<typeof Press>;
  "setup-disks": z.infer<typeof Disk>;
  stats: Record<string, never>;
};
export type Request = {
  [K in keyof Requests]: [operation: K, input: Requests[K], signal: AbortSignal];
}[keyof Requests];
export type Handler = (...request: Request) => Promise<Response>;
// Both applications expose the same guest protocol. This module contains validation only.
export const routes = (options: { token: string; handle: Handler }) => {
  const handle = options.handle;
  return new Hono()
    .use("*", bearerAuth({ token: options.token }))
    .post("/reserve", zValidator("json", Reserve), (c) =>
      handle("reserve", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/start", zValidator("json", Start), (c) =>
      handle("start", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/stop", zValidator("json", Stop), (c) =>
      handle("stop", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/relinquish", zValidator("json", Job), (c) =>
      handle("relinquish", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/abort", zValidator("json", Job), (c) =>
      handle("abort", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/save", zValidator("json", Job), (c) =>
      handle("save", c.req.valid("json"), c.req.raw.signal),
    )
    .get("/image", zValidator("query", Job), (c) =>
      handle("image", c.req.valid("query"), c.req.raw.signal),
    )
    .get("/serial", zValidator("query", Job), (c) =>
      handle("serial", c.req.valid("query"), c.req.raw.signal),
    )
    .get("/follow", zValidator("query", Job), (c) =>
      handle("follow", c.req.valid("query"), c.req.raw.signal),
    )
    .get("/stats", (c) => handle("stats", {}, c.req.raw.signal))
    .get("/setup-disks", zValidator("query", Disk), (c) =>
      handle("setup-disks", c.req.valid("query"), c.req.raw.signal),
    )
    .post("/send-keys", zValidator("json", Keys), (c) =>
      handle("send-keys", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/intent/start", zValidator("json", Intent), (c) =>
      handle("intent/start", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/intent/end", zValidator("json", Job), (c) =>
      handle("intent/end", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/move", zValidator("json", Move), (c) =>
      handle("mouse/move", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/click", zValidator("json", Press), (c) =>
      handle("mouse/click", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/double-click", zValidator("json", Press), (c) =>
      handle("mouse/double-click", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/drag", zValidator("json", Drag), (c) =>
      handle("mouse/drag", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/scroll", zValidator("json", Scroll), (c) =>
      handle("mouse/scroll", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/hold", zValidator("json", Press), (c) =>
      handle("mouse/hold", c.req.valid("json"), c.req.raw.signal),
    )
    .post("/mouse/release", zValidator("json", Press), (c) =>
      handle("mouse/release", c.req.valid("json"), c.req.raw.signal),
    );
};
export type Routes = ReturnType<typeof routes>;
