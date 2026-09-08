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
const text = Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "text/plain" }));

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
  success: text,
  error: [Errors.ForbiddenWire, Errors.UnknownSessionWire],
});

export const dump = HttpApiEndpoint.get("dump", "/dump", {
  query: Contract.IdQuery,
  success: text,
  error: [Errors.UnknownSessionWire, Errors.ConflictWire],
});

export const follow = HttpApiEndpoint.get("follow", "/follow", {
  query: Contract.IdQuery,
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
  .add(dump)
  .add(follow)
  .add(stats)
  .add(stop)
  .add(sendKeys)
  .add(sendMouse)
  .add(intentStart)
  .add(intentEnd)
  .middleware(BearerAuth)
  .middleware(ApiBoundary) {}

// A stored image has one address, the dashboard's (Contract.StoredImageUrl); no proxy serves it.
export class ProxyApi extends HttpApi.make("OligarchyProxy").add(Sessions) {}

// The reverse proxy: the proxy's own endpoints, so the client that speaks to a server speaks to
// it, minus /stats (a fleet has no one cpu), behind the routing boundary.
export class RoutedSessions extends HttpApiGroup.make("Sessions")
  .add(start)
  .add(image)
  .add(serial)
  .add(dump)
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

export class ReverseProxyApi extends HttpApi.make("OligarchyReverseProxy")
  .add(RoutedSessions)
  .add(Servers) {}

export const VERSION = "0.0.0";
