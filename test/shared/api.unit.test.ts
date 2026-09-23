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

// The OpenAPI operation of a path item for a method the apis use; none for any other method.
const operationOf = (
  item: OpenApi.OpenAPISpec["paths"][string] | undefined,
  method: string,
): OpenApi.OpenAPISpec["paths"][string]["get"] => {
  if (method === "GET") {
    return item?.get;
  }
  if (method === "POST") {
    return item?.post;
  }
  if (method === "DELETE") {
    return item?.delete;
  }
  return undefined;
};

// One endpoint per mouse operation, all with the driving endpoints' errors.
const MOUSE_ENDPOINTS = [
  "mouseMove",
  "mouseClick",
  "mouseDoubleClick",
  "mouseScroll",
  "mouseDrag",
  "mouseHold",
  "mouseRelease",
] as const;

describe("QemuServerApi", () => {
  it("declares every path with today's method", () => {
    const table = routes(Api.QemuServerApi).map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(
      [
        "POST /reserve",
        "POST /relinquish",
        "POST /start",
        "GET /image",
        "GET /serial",
        "GET /follow",
        "GET /stats",
        "GET /minted",
        "POST /stop",
        "POST /save",
        "POST /send-keys",
        "POST /mouse/move",
        "POST /mouse/click",
        "POST /mouse/double-click",
        "POST /mouse/scroll",
        "POST /mouse/drag",
        "POST /mouse/hold",
        "POST /mouse/release",
        "POST /intent/start",
        "POST /intent/end",
      ].sort(),
    );
  });

  it("builds every url through the client url builder", () => {
    const urls = HttpApiClient.urlBuilder(Api.QemuServerApi);
    expect(urls.Sessions.reserve()).toBe("/reserve");
    expect(urls.Sessions.relinquish()).toBe("/relinquish");
    expect(urls.Sessions.start()).toBe("/start");
    expect(urls.Sessions.image({ query: { id: "abc", agent: "OLI-61" } })).toBe(
      "/image?id=abc&agent=OLI-61",
    );
    expect(urls.Sessions.serial({ query: { id: "a b", agent: "x" } })).toBe(
      "/serial?id=a+b&agent=x",
    );
    expect(urls.Sessions.follow({ query: { id: "abc" } })).toBe("/follow?id=abc");
    expect(urls.Sessions.stats()).toBe("/stats");
    expect(urls.Sessions.minted({ query: { iso: "https://x/y.iso" } })).toBe(
      "/minted?iso=https%3A%2F%2Fx%2Fy.iso",
    );
    expect(urls.Sessions.stop()).toBe("/stop");
    expect(urls.Sessions.save()).toBe("/save");
    expect(urls.Sessions.sendKeys()).toBe("/send-keys");
    expect(urls.Sessions.mouseMove()).toBe("/mouse/move");
    expect(urls.Sessions.mouseClick()).toBe("/mouse/click");
    expect(urls.Sessions.mouseDoubleClick()).toBe("/mouse/double-click");
    expect(urls.Sessions.mouseScroll()).toBe("/mouse/scroll");
    expect(urls.Sessions.mouseDrag()).toBe("/mouse/drag");
    expect(urls.Sessions.mouseHold()).toBe("/mouse/hold");
    expect(urls.Sessions.mouseRelease()).toBe("/mouse/release");
    expect(urls.Sessions.intentStart()).toBe("/intent/start");
    expect(urls.Sessions.intentEnd()).toBe("/intent/end");
  });

  it("does not declare endpoints the plan does not name", () => {
    const table = routes(Api.QemuServerApi).map(({ method, path }) => `${method} ${path}`);
    expect(table).not.toContain("DELETE /start");
    expect(table).not.toContain("GET /start");
    // ctrl reads an ended session's console from the database's debug logs; a running one is
    // its driver's, through /serial.
    expect(table).not.toContain("GET /dump");
    expect(routes(Api.QemuServerApi).map((route) => route.identifier)).not.toContain("notFound");
  });

  it("requires the bearer on every endpoint", () => {
    const spec = OpenApi.fromApi(Api.QemuServerApi);
    expect(spec.components.securitySchemes).toEqual({
      bearer: { type: "http", scheme: "Bearer" },
    });
    for (const route of routes(Api.QemuServerApi)) {
      const item = spec.paths[route.path];
      expect(item).toBeDefined();
      const operation = operationOf(item, route.method);
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
    }
  });

  it("applies BearerAuth then ApiBoundary to every endpoint", () => {
    for (const route of routes(Api.QemuServerApi)) {
      expect(route.group).toBe("Sessions");
      expect(route.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    }
  });

  it("declares the error statuses of §2.4 plus the middleware's 400, 401 and 500", () => {
    const sessions = [400, 401, 500];
    // 409: a resume this machine has no minted disk for. 502: the machine failed to boot.
    // 503: only /reserve, when the server is at --max-jobs.
    expect(byIdentifier(Api.QemuServerApi, "reserve").errors).toEqual(
      ascending([...sessions, 409, 503]),
    );
    expect(byIdentifier(Api.QemuServerApi, "relinquish").errors).toEqual(sessions);
    expect(byIdentifier(Api.QemuServerApi, "start").errors).toEqual([...sessions, 502]);
    expect(byIdentifier(Api.QemuServerApi, "image").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.QemuServerApi, "serial").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.QemuServerApi, "follow").errors).toEqual(
      [...sessions, 404, 409].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.QemuServerApi, "stats").errors).toEqual(sessions);
    expect(byIdentifier(Api.QemuServerApi, "stop").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    // 502: the guest did not power off, or its disk could not be kept.
    expect(byIdentifier(Api.QemuServerApi, "save").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.QemuServerApi, "sendKeys").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    for (const mouse of MOUSE_ENDPOINTS) {
      expect(byIdentifier(Api.QemuServerApi, mouse).errors, mouse).toEqual(
        [...sessions, 403, 404, 502].sort((a, b) => a - b),
      );
    }
    expect(byIdentifier(Api.QemuServerApi, "intentStart").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    expect(byIdentifier(Api.QemuServerApi, "intentEnd").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
  });

  it("exposes the version string the CLIs report", () => {
    expect(Api.VERSION).toBe("0.0.0");
  });
});

describe("QemuReverseProxyApi", () => {
  const reverse = Api.QemuReverseProxyApi;

  it("declares every routed path of QemuServerApi but /stats, plus the four server routes", () => {
    const table = routes(reverse).map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(
      [
        "POST /reserve",
        "POST /relinquish",
        "POST /start",
        "GET /image",
        "GET /serial",
        "GET /follow",
        "POST /stop",
        "POST /save",
        "POST /send-keys",
        "POST /mouse/move",
        "POST /mouse/click",
        "POST /mouse/double-click",
        "POST /mouse/scroll",
        "POST /mouse/drag",
        "POST /mouse/hold",
        "POST /mouse/release",
        "POST /intent/start",
        "POST /intent/end",
        "POST /servers",
        "DELETE /servers",
        "GET /servers",
        "GET /minted",
      ].sort(),
    );
    expect(table).not.toContain("GET /stats");
    // The fleet's /minted is the Servers group's own answer, one row per server, not a route to
    // one server.
    expect(routes(reverse).find((route) => route.path === "/minted")?.group).toBe("Servers");
  });

  it("keeps the routed endpoints' identifiers and inputs so the QemuServerApi client reaches them", () => {
    const qemu = routes(Api.QemuServerApi);
    for (const route of routes(reverse)) {
      if (route.group !== "Sessions") {
        continue;
      }
      const twin = qemu.find((candidate) => candidate.identifier === route.identifier);
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
      const operation = operationOf(item, route.method);
      expect(operation, `${route.method} ${route.path}`).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
    }
  });

  it("declares the boundary's 400, 401, 404, 500, 502 and 503 on every endpoint plus each endpoint's own", () => {
    // 404: a pinned reserve naming a server the fleet does not know; declared once, on the boundary,
    // so the endpoints that answer 404 themselves list it once.
    const boundary = [400, 401, 404, 500, 502, 503];
    // 409: a resume no server that holds the disk can take, naming one that has a free slot.
    expect(byIdentifier(reverse, "reserve").errors).toEqual(ascending([...boundary, 409]));
    expect(byIdentifier(reverse, "relinquish").errors).toEqual(boundary);
    expect(byIdentifier(reverse, "start").errors).toEqual(boundary);
    expect(byIdentifier(reverse, "image").errors).toEqual(ascending([...boundary, 403]));
    expect(byIdentifier(reverse, "serial").errors).toEqual(ascending([...boundary, 403]));
    expect(byIdentifier(reverse, "follow").errors).toEqual(ascending([...boundary, 409]));
    expect(byIdentifier(reverse, "stop").errors).toEqual(ascending([...boundary, 403]));
    // save's own 502 is the boundary's 502 too: one status, declared once.
    expect(byIdentifier(reverse, "save").errors).toEqual(ascending([...boundary, 403]));
    expect(byIdentifier(reverse, "sendKeys").errors).toEqual(ascending([...boundary, 403]));
    for (const mouse of MOUSE_ENDPOINTS) {
      expect(byIdentifier(reverse, mouse).errors, mouse).toEqual(ascending([...boundary, 403]));
    }
    expect(byIdentifier(reverse, "intentStart").errors).toEqual(ascending([...boundary, 403]));
    expect(byIdentifier(reverse, "intentEnd").errors).toEqual(ascending([...boundary, 403]));
    expect(byIdentifier(reverse, "register").errors).toEqual(boundary);
    expect(byIdentifier(reverse, "unregister").errors).toEqual(boundary);
    expect(byIdentifier(reverse, "servers").errors).toEqual(boundary);
  });

  it("leaves QemuServerApi untouched: no server routes and no RouteBoundary", () => {
    const table = routes(Api.QemuServerApi).map(({ method, path }) => `${method} ${path}`);
    expect(table).not.toContain("POST /servers");
    expect(table).not.toContain("GET /servers");
    for (const route of routes(Api.QemuServerApi)) {
      expect(route.middleware).not.toContain(Api.RouteBoundary.key);
    }
  });
});

describe("AutomationServerApi", () => {
  const automation = Api.AutomationServerApi;

  it("declares POST /linear and POST /abort", () => {
    const table = routes(automation).map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(["POST /abort", "POST /linear"]);
    expect(HttpApiClient.urlBuilder(automation).Linear.linear()).toBe("/linear");
    expect(HttpApiClient.urlBuilder(automation).Abort.abort()).toBe("/abort");
  });

  it("keeps /linear unsigned and requires the bearer on /abort", () => {
    const spec = OpenApi.fromApi(automation);
    const linear = byIdentifier(automation, "linear");
    expect(linear.group).toBe("Linear");
    expect(linear.middleware).toEqual([Api.ApiBoundary.key]);
    expect(spec.paths["/linear"]?.post?.security).toEqual([]);
    expect(linear.errors).toEqual([400, 401, 500]);
    const abort = byIdentifier(automation, "abort");
    expect(abort.group).toBe("Abort");
    expect(abort.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    expect(spec.paths["/abort"]?.post?.security).toEqual([{ bearer: [] }]);
    // A client that holds nothing is no 404 here: the job closes and the answer is 200.
    expect(abort.errors).toEqual([400, 401, 500]);
  });

  it("is its own api: neither the qemu server nor the qemu reverse proxy answers /linear", () => {
    expect(routes(Api.QemuServerApi).map(({ path }) => path)).not.toContain("/linear");
    expect(routes(Api.QemuReverseProxyApi).map(({ path }) => path)).not.toContain("/linear");
  });
});

describe("AutomationClientApi", () => {
  const client = Api.AutomationClientApi;

  it("declares POST /reserve, POST /run and POST /abort", () => {
    const table = routes(client).map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(["POST /abort", "POST /reserve", "POST /run"]);
    expect(HttpApiClient.urlBuilder(client).Runs.reserve()).toBe("/reserve");
    expect(HttpApiClient.urlBuilder(client).Runs.run()).toBe("/run");
    expect(HttpApiClient.urlBuilder(client).Runs.abort()).toBe("/abort");
  });

  it("requires the bearer and applies BearerAuth then ApiBoundary", () => {
    const spec = OpenApi.fromApi(client);
    const reserve = byIdentifier(client, "reserve");
    expect(reserve.group).toBe("Runs");
    expect(reserve.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    expect(spec.paths["/reserve"]?.post?.security).toEqual([{ bearer: [] }]);
    expect(reserve.errors).toEqual([400, 401, 409, 500, 503]);
    const run = byIdentifier(client, "run");
    expect(run.group).toBe("Runs");
    expect(run.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    expect(spec.paths["/run"]?.post?.security).toEqual([{ bearer: [] }]);
    // 500: opencode failed. Capacity is /reserve's 503.
    expect(run.errors).toEqual([400, 401, 500]);
    const abort = byIdentifier(client, "abort");
    expect(abort.group).toBe("Runs");
    expect(abort.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
    expect(spec.paths["/abort"]?.post?.security).toEqual([{ bearer: [] }]);
    expect(abort.errors).toEqual([400, 401, 404, 500]);
  });

  it("is its own api: no other process answers /run; /abort is the client and the automation server", () => {
    expect(routes(Api.QemuServerApi).map(({ path }) => path)).not.toContain("/run");
    expect(routes(Api.QemuReverseProxyApi).map(({ path }) => path)).not.toContain("/run");
    expect(routes(Api.AutomationServerApi).map(({ path }) => path)).not.toContain("/run");
    expect(routes(Api.QemuServerApi).map(({ path }) => path)).not.toContain("/abort");
    expect(routes(Api.QemuReverseProxyApi).map(({ path }) => path)).not.toContain("/abort");
    expect(routes(Api.AutomationServerApi).map(({ path }) => path)).toContain("/abort");
  });
});
