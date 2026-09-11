import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "effect/unstable/httpapi";
import * as Contract from "./contract.ts";
import * as Errors from "./errors.ts";

export class BearerAuth extends HttpApiMiddleware.Service<BearerAuth>()(
  "@oligarchy/shared/api/BearerAuth",
  {
    error: Errors.UnauthorizedWire,
    security: { bearer: HttpApiSecurity.bearer },
    requiredForClient: true,
  },
) {}

export class ApiBoundary extends HttpApiMiddleware.Service<ApiBoundary>()(
  "@oligarchy/shared/api/ApiBoundary",
  {
    error: [Errors.BadRequestWire, Errors.InternalWire],
  },
) {}

// The reverse proxy's boundary: the same code as ApiBoundary, declaring as well the two answers
// only a router gives — a server that failed it and no server to place on.
export class RouteBoundary extends HttpApiMiddleware.Service<RouteBoundary>()(
  "@oligarchy/shared/api/RouteBoundary",
  {
    error: [
      Errors.BadRequestWire,
      Errors.InternalWire,
      Errors.ServerFailedWire,
      Errors.NoServerWire,
    ],
  },
) {}

const png = Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "image/png" }));

// Sessions group: bearer required
export const start = HttpApiEndpoint.post("start", "/start", {
  payload: Contract.StartBody,
  success: Contract.StartResponse,
  error: Errors.StartFailedWire,
});

export const image = HttpApiEndpoint.get("image", "/image", {
  query: Contract.SessionQuery,
  success: HttpApiSchema.WithHeaders(png, { "x-image-url": Schema.String }),
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire, Errors.ExchangeFailedWire],
});

export const serial = HttpApiEndpoint.get("serial", "/serial", {
  query: Contract.SessionQuery,
  success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "text/plain" })),
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire],
});

// A follower watches, so it names no agent.
export const follow = HttpApiEndpoint.get("follow", "/follow", {
  query: { id: Schema.String },
  success: HttpApiSchema.StreamUint8Array({ contentType: "application/x-ndjson" }),
  error: [Errors.UnknownSessionWire, Errors.ConflictWire],
});

export const stats = HttpApiEndpoint.get("stats", "/stats", {
  success: Contract.Stats,
});

export const stop = HttpApiEndpoint.post("stop", "/stop", {
  payload: Contract.StopBody,
  success: Contract.Ok,
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire],
});

export const sendKeys = HttpApiEndpoint.post("sendKeys", "/send-keys", {
  payload: Contract.SendKeysBody,
  success: Contract.Ok,
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire, Errors.ExchangeFailedWire],
});

export const sendMouse = HttpApiEndpoint.post("sendMouse", "/send-mouse", {
  payload: Contract.SendMouseBody,
  success: Contract.Ok,
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire, Errors.ExchangeFailedWire],
});

export const intentStart = HttpApiEndpoint.post("intentStart", "/intent/start", {
  payload: Contract.IntentStartBody,
  success: Contract.Ok,
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire],
});

export const intentEnd = HttpApiEndpoint.post("intentEnd", "/intent/end", {
  payload: Contract.IntentEndBody,
  success: Contract.Ok,
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire],
});

// BearerAuth first, ApiBoundary second: middlewares wrap successively, so ApiBoundary is
// outermost and sees an Unauthorized on its way out.
export class Sessions extends HttpApiGroup.make("Sessions")
  .add(start)
  .add(image)
  .add(serial)
  .add(follow)
  .add(stats)
  .add(stop)
  .add(sendKeys)
  .add(sendMouse)
  .add(intentStart)
  .add(intentEnd)
  .middleware(BearerAuth)
  .middleware(ApiBoundary) {}

// A stored image has one address, the dashboard's (Contract.StoredImageUrl); no qemu server serves it.
export class QemuServerApi extends HttpApi.make("OligarchyQemuServer").add(Sessions) {}

// The qemu reverse proxy: the qemu server's own endpoints, so the client that speaks to a server speaks to
// it, minus /stats (a fleet has no one cpu), behind the routing boundary.
export class RoutedSessions extends HttpApiGroup.make("Sessions")
  .add(start)
  .add(image)
  .add(serial)
  .add(follow)
  .add(stop)
  .add(sendKeys)
  .add(sendMouse)
  .add(intentStart)
  .add(intentEnd)
  .middleware(BearerAuth)
  .middleware(RouteBoundary) {}

// Servers group: the fleet the reverse proxy places on; bearer required
export const register = HttpApiEndpoint.post("register", "/servers", {
  payload: Contract.ServerBody,
  success: Contract.Ok,
});

export const unregister = HttpApiEndpoint.delete("unregister", "/servers", {
  payload: Contract.ServerBody,
  success: Contract.Ok,
  error: Errors.NotFoundWire,
});

export const servers = HttpApiEndpoint.get("servers", "/servers", {
  success: Contract.Servers,
});

export class Servers extends HttpApiGroup.make("Servers")
  .add(register)
  .add(unregister)
  .add(servers)
  .middleware(BearerAuth)
  .middleware(RouteBoundary) {}

export class QemuReverseProxyApi extends HttpApi.make("OligarchyQemuReverseProxy")
  .add(RoutedSessions)
  .add(Servers) {}

// The automation server: POST /linear is Linear's signed webhook. No oligarchy bearer —
// Linear signs the body. The qemu server's own boundary suffices: this process neither forwards
// nor places.
export const linear = HttpApiEndpoint.post("linear", "/linear", {
  success: Contract.Ok,
  error: Errors.UnauthorizedWire,
});

export class Linear extends HttpApiGroup.make("Linear").add(linear).middleware(ApiBoundary) {}

export class AutomationServerApi extends HttpApi.make("OligarchyAutomationServer").add(Linear) {}

export const run = HttpApiEndpoint.post("run", "/run", {
  payload: Contract.RunBody,
  success: Contract.Ok,
  error: Errors.RunFailedWire,
});

export const abort = HttpApiEndpoint.post("abort", "/abort", {
  payload: Contract.AbortBody,
  success: Contract.Ok,
  error: Errors.UnknownSessionWire,
});

export class Runs extends HttpApiGroup.make("Runs")
  .add(run)
  .add(abort)
  .middleware(BearerAuth)
  .middleware(ApiBoundary) {}

export class AutomationClientApi extends HttpApi.make("OligarchyAutomationClient").add(Runs) {}

export const VERSION = "0.0.0";
