import { describe, expect, it } from "vitest";
import { HttpApi, HttpApiClient, OpenApi } from "effect/unstable/httpapi";
import * as Api from "../../src/shared/api.ts";

type Route = {
  readonly group: string;
  readonly identifier: string;
  readonly method: string;
  readonly path: string;
  readonly errors: ReadonlyArray<number>;
  readonly middleware: ReadonlyArray<string>;
};

const routes = (): ReadonlyArray<Route> => {
  const collected: Array<Route> = [];
  HttpApi.reflect(Api.ProxyApi, {
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

const byIdentifier = (identifier: string): Route => {
  const route = routes().find((candidate) => candidate.identifier === identifier);
  if (route === undefined) {
    throw new Error(`no endpoint ${identifier}`);
  }
  return route;
};

describe("ProxyApi", () => {
  it("declares every path with today's method", () => {
    const table = routes().map(({ method, path }) => `${method} ${path}`);
    expect(table.sort()).toEqual(
      [
        "POST /start",
        "GET /image",
        "GET /serial",
        "GET /dump",
        "GET /follow",
        "GET /stats",
        "POST /stop",
        "POST /send-keys",
        "POST /send-mouse",
        "POST /intent/start",
        "POST /intent/end",
        "GET /images/:id",
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
    expect(urls.Sessions.dump({ query: { id: "abc" } })).toBe("/dump?id=abc");
    expect(urls.Sessions.follow({ query: { id: "abc" } })).toBe("/follow?id=abc");
    expect(urls.Sessions.stats()).toBe("/stats");
    expect(urls.Sessions.stop()).toBe("/stop");
    expect(urls.Sessions.sendKeys()).toBe("/send-keys");
    expect(urls.Sessions.sendMouse()).toBe("/send-mouse");
    expect(urls.Sessions.intentStart()).toBe("/intent/start");
    expect(urls.Sessions.intentEnd()).toBe("/intent/end");
    expect(urls.Images.storedImage({ params: { id: "abc" } })).toBe("/images/abc");
  });

  it("does not declare endpoints the plan does not name", () => {
    const table = routes().map(({ method, path }) => `${method} ${path}`);
    expect(table).not.toContain("DELETE /start");
    expect(table).not.toContain("GET /start");
    expect(routes().map((route) => route.identifier)).not.toContain("notFound");
  });

  it("requires the bearer on every Sessions endpoint and on none of Images", () => {
    const spec = OpenApi.fromApi(Api.ProxyApi);
    expect(spec.components.securitySchemes).toEqual({
      bearer: { type: "http", scheme: "Bearer" },
    });
    for (const route of routes()) {
      const item = spec.paths[route.path.replace(/:(\w+)/g, "{$1}")];
      expect(item).toBeDefined();
      const operation =
        route.method === "GET" ? item?.get : route.method === "POST" ? item?.post : undefined;
      expect(operation).toBeDefined();
      if (route.group === "Sessions") {
        expect(operation?.security).toEqual([{ bearer: [] }]);
      } else {
        expect(operation?.security).toEqual([]);
      }
    }
  });

  it("applies BearerAuth then ApiBoundary to Sessions and only ApiBoundary to Images", () => {
    for (const route of routes()) {
      if (route.group === "Sessions") {
        expect(route.middleware).toEqual([Api.BearerAuth.key, Api.ApiBoundary.key]);
      } else {
        expect(route.middleware).toEqual([Api.ApiBoundary.key]);
      }
    }
  });

  it("declares the error statuses of §2.4 plus the middleware's 400, 401 and 500", () => {
    const sessions = [400, 401, 500];
    expect(byIdentifier("start").errors).toEqual([...sessions, 502]);
    expect(byIdentifier("image").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier("serial").errors).toEqual([...sessions, 403, 404].sort((a, b) => a - b));
    expect(byIdentifier("dump").errors).toEqual([...sessions, 404, 409].sort((a, b) => a - b));
    expect(byIdentifier("follow").errors).toEqual([...sessions, 404, 409].sort((a, b) => a - b));
    expect(byIdentifier("stats").errors).toEqual(sessions);
    expect(byIdentifier("stop").errors).toEqual([...sessions, 403, 404].sort((a, b) => a - b));
    expect(byIdentifier("sendKeys").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier("sendMouse").errors).toEqual(
      [...sessions, 403, 404, 502].sort((a, b) => a - b),
    );
    expect(byIdentifier("intentStart").errors).toEqual(
      [...sessions, 403, 404].sort((a, b) => a - b),
    );
    expect(byIdentifier("intentEnd").errors).toEqual([...sessions, 403, 404].sort((a, b) => a - b));
    expect(byIdentifier("storedImage").errors).toEqual([400, 404, 500]);
  });

  it("exposes the version string the CLIs report", () => {
    expect(Api.VERSION).toBe("0.0.0");
  });
});
