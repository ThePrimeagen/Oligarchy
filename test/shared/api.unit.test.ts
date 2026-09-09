import { describe, expect, it } from "vitest";
import { HttpApi, HttpApiClient, type HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import * as Api from "../../src/shared/api.ts";

type Route = {
  readonly group: string;
  readonly identifier: string;
  readonly method: string;
  readonly path: string;
  readonly errors: ReadonlyArray<number>;
  readonly middleware: ReadonlyArray<string>;
};

const routes = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
): ReadonlyArray<Route> => {
  const collected: Array<Route> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, errors, middleware }) => {
      collected.push({
        group: group.identifier,
        identifier: endpoint.identifier,
        method: endpoint.method,
        path: endpoint.path,
        errors: [...errors.keys()].sort((a, b) => a - b),
        middleware: [...middleware].map((service) => service.key),
      });
    },
  });
  return collected;
};

const byIdentifier = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
  identifier: string,
): Route => {
  const route = routes(api).find((candidate) => candidate.identifier === identifier);
  if (route === undefined) {
    throw new Error(`no endpoint ${identifier}`);
  }
  return route;
};

const ascending = (statuses: ReadonlyArray<number>): ReadonlyArray<number> =>
  [...statuses].sort((a, b) => a - b);

describe("ProxyApi", () => {
  it("declares every path with today's method", () => {
    const table = routes(Api.ProxyApi).map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(
      [
        "POST /start",
        "GET /image",
        "GET /serial",
        "GET /follow",
        "GET /stats",
        "POST /stop",
        "POST /send-keys",
        "POST /send-mouse",
        "POST /intent/start",
        "POST /intent/end",
      ].sort(),
    );
  });

  it("builds every url through the client url builder", () => {
    const urls = HttpApiClient.urlBuilder(Api.ProxyApi);
    expect(urls.Sessions.start()).toBe("/start");
    expect(urls.Sessions.image({ query: { id: "abc", agent: "OLI-61" } })).toBe(
      "/image?id=abc&agent=OLI-61",
    );
    expect(urls.Sessions.serial({ query: { id: "a b", agent: "x" } })).toBe(
      "/serial?id=a+b&agent=x",
    );
    expect(urls.Sessions.follow({ query: { id: "abc" } })).toBe("/follow?id=abc");
    expect(urls.Sessions.stats()).toBe("/stats");
    expect(urls.Sessions.stop()).toBe("/stop");
    expect(urls.Sessions.sendKeys()).toBe("/send-keys");
    expect(urls.Sessions.sendMouse()).toBe("/send-mouse");
    expect(urls.Sessions.intentStart()).toBe("/intent/start");
    expect(urls.Sessions.intentEnd()).toBe("/intent/end");
  });

  it("does not declare endpoints the plan does not name", () => {
    const table = routes(Api.ProxyApi).map(({ method, path }) => `${method} ${path}`);
    expect(table).not.toContain("DELETE /start");
    expect(table).not.toContain("GET /start");
    // ctrl reads an ended session's console from the database's debug logs; a running one is
    // its driver's, through /serial.
    expect(table).not.toContain("GET /dump");
    expect(routes(Api.ProxyApi).map((route) => route.identifier)).not.toContain("notFound");
  });

  it("requires the bearer on every endpoint", () => {
    const spec = OpenApi.fromApi(Api.ProxyApi);
    expect(spec.components.securitySchemes).toEqual({
      bearer: { type: "http", scheme: "Bearer" },
    });
    for (const route of routes(Api.ProxyApi)) {
      const item = spec.paths[route.path];
      expect(item).toBeDefined();
      const operation =
        route.method === "GET" ? item?.get : route.method === "POST" ? item?.post : undefined;
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
    }
  });

  it("applies BearerAuth then ApiBoundary to every endpoint", () => {
    for (const route of routes(Api.ProxyApi)) {
      expect(route.group).toBe("Sessions");
      expect(route.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    }
  });

  it("declares the error statuses of §2.4 plus the middleware's 400, 401 and 500", () => {
    const sessions = [400, 401, 500];
    expect(byIdentifier(Api.ProxyApi, "start").errors).toEqual([...sessions, 502]);
    expect(byIdentifier(Api.ProxyApi, "image").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "serial").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "follow").errors).toEqual(
      [...sessions, 404, 409].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "stats").errors).toEqual(sessions);
    expect(byIdentifier(Api.ProxyApi, "stop").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "sendKeys").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "sendMouse").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "intentStart").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.ProxyApi, "intentEnd").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
  });

  it("exposes the version string the CLIs report", () => {
    expect(Api.VERSION).toBe("0.0.0");
  });
});

describe("ReverseProxyApi", () => {
  const reverse = Api.ReverseProxyApi;

  it("declares every routed path of ProxyApi but /stats, plus the three server routes", () => {
    const table = routes(reverse).map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(
      [
        "POST /start",
        "GET /image",
        "GET /serial",
        "GET /follow",
        "POST /stop",
        "POST /send-keys",
        "POST /send-mouse",
        "POST /intent/start",
        "POST /intent/end",
        "POST /servers",
        "DELETE /servers",
        "GET /servers",
      ].sort(),
    );
    expect(table).not.toContain("GET /stats");
  });

  it("keeps the routed endpoints' identifiers and inputs so the ProxyApi client reaches them", () => {
    const proxy = routes(Api.ProxyApi);
    for (const route of routes(reverse)) {
      if (route.group !== "Sessions") {
        continue;
      }
      const twin = proxy.find((candidate) => candidate.identifier === route.identifier);
      expect(twin, route.identifier).toMatchObject({ method: route.method, path: route.path });
    }
    const urls = HttpApiClient.urlBuilder(reverse);
    expect(urls.Servers.register()).toBe("/servers");
    expect(urls.Servers.unregister()).toBe("/servers");
    expect(urls.Servers.servers()).toBe("/servers");
  });

  it("requires the bearer and applies BearerAuth then RouteBoundary on every endpoint", () => {
    const spec = OpenApi.fromApi(reverse);
    for (const route of routes(reverse)) {
      expect(route.middleware).toEqual([Api.BearerAuth.key, Api.RouteBoundary.key]);
      const item = spec.paths[route.path];
      const operation =
        route.method === "GET"
          ? item?.get
          : route.method === "POST"
            ? item?.post
            : route.method === "DELETE"
              ? item?.delete
              : undefined;
      expect(operation, `${route.method} ${route.path}`).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
    }
  });

  it("declares the boundary's 400, 401, 500, 502 and 503 on every endpoint plus each endpoint's own", () => {
    const boundary = [400, 401, 500, 502, 503];
    expect(byIdentifier(reverse, "start").errors).toEqual(boundary);
    expect(byIdentifier(reverse, "image").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "serial").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "follow").errors).toEqual(ascending([...boundary, 404, 409]));
    expect(byIdentifier(reverse, "stop").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "sendKeys").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "sendMouse").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "intentStart").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "intentEnd").errors).toEqual(ascending([...boundary, 403, 404]));
    expect(byIdentifier(reverse, "register").errors).toEqual(boundary);
    expect(byIdentifier(reverse, "unregister").errors).toEqual(ascending([...boundary, 404]));
    expect(byIdentifier(reverse, "servers").errors).toEqual(boundary);
  });

  it("leaves ProxyApi untouched: no server routes and no RouteBoundary", () => {
    const table = routes(Api.ProxyApi).map(({ method, path }) => `${method} ${path}`);
    expect(table).not.toContain("POST /servers");
    expect(table).not.toContain("GET /servers");
    for (const route of routes(Api.ProxyApi)) {
      expect(route.middleware).not.toContain(Api.RouteBoundary.key);
    }
  });
});

describe("AutomationApi", () => {
  const automation = Api.AutomationApi;

  it("declares POST /automate and nothing else", () => {
    const table = routes(automation).map(({ method, path }) => `${method} ${path}`);
    expect(table).toEqual(["POST /automate"]);
    expect(HttpApiClient.urlBuilder(automation).Automations.automate()).toBe("/automate");
  });

  it("requires the bearer and applies BearerAuth then ApiBoundary", () => {
    const spec = OpenApi.fromApi(automation);
    expect(spec.components.securitySchemes).toEqual({
      bearer: { type: "http", scheme: "Bearer" },
    });
    const route = byIdentifier(automation, "automate");
    expect(route.group).toBe("Automations");
    expect(route.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    expect(spec.paths["/automate"]?.post?.security).toEqual([{ bearer: [] }]);
    expect(route.errors).toEqual([400, 401, 500]);
  });

  it("is its own api: neither the proxy nor the reverse proxy answers /automate", () => {
    expect(routes(Api.ProxyApi).map(({ path }) => path)).not.toContain("/automate");
    expect(routes(Api.ReverseProxyApi).map(({ path }) => path)).not.toContain("/automate");
  });
});
