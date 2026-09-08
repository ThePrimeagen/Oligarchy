import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpServer,
} from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Config from "../../src/config.ts";
import * as Diagnostics from "../../src/reverse-proxy/diagnostics.ts";
import * as Router from "../../src/reverse-proxy/router.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const SERVER_A = "http://10.0.0.5:42069";
const SERVER_B = "http://10.0.0.6:42069";

const stats = (qemus: number) => ({
  qemus,
  memory: { totalBytes: 16_000_000_000, usedBytes: 4_000_000_000, freeBytes: 12_000_000_000 },
  cpu: { cores: 4, mean: 12.5, p10: 10, p25: 11, p75: 14, p90: 15 },
});

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make("test-token"),
  databaseUrl: Redacted.make("postgres://unused"),
});

// A server that refuses the connection: what node:http reports for a host that is down.
const refused = (request: HttpClientRequest.HttpClientRequest, url: URL) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({
        request,
        cause: new Error(`connect ECONNREFUSED ${url.host}`),
      }),
    }),
  );

// A answers its /stats with two machines; B is down.
const fleet: FakeHttp.Respond = (request, url) =>
  url.origin === SERVER_B ? refused(request, url) : FakeHttp.json(stats(2));

type Fixture = {
  readonly store: Stores.FakeServerStore;
  readonly upstream: FakeHttp.Recorder;
  readonly log: FakeLog.FakeLog;
};

const fixture = (respond: FakeHttp.Respond = fleet, overrides: Partial<Fixture> = {}): Fixture => ({
  store: Stores.fakeServerStore(),
  upstream: FakeHttp.recordRequests(respond),
  log: FakeLog.fakeLog(),
  ...overrides,
});

// The page on a loopback server; the servers are the recorder's HttpClient, given to the Router
// alone, so the HttpClient in scope points at the page.
const serve = (fixed: Fixture) =>
  HttpServer.serve(Diagnostics.handler).pipe(
    Layer.provide(
      Router.Router.layer.pipe(
        Layer.provide(
          Layer.mergeAll(fixed.store.layer, fixed.log.layer, fixed.upstream.layer, ProxyConfigLive),
        ),
      ),
    ),
    Layer.provide(fixed.log.layer),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

const form = (url: string) => HttpBody.urlParams({ url });

// The test client is fetch, which follows a 303 to / on its own; a browser does the same, but the
// test wants to see the redirect itself.
const manualRedirects = Effect.provideService(FetchHttpClient.RequestInit, {
  keepalive: false,
  redirect: "manual",
});

describe("the page", () => {
  it.effect("GET / with nothing registered says so and offers the add form, without a token", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.get("/");
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/html");
        const html = yield* response.text;
        expect(html).toContain("<title>oligarchy reverse proxy</title>");
        expect(html).toContain("<h1>oligarchy reverse proxy</h1>");
        expect(html).toContain("no servers registered");
        expect(html).toContain('<form method="post" action="/servers">');
        expect(html).toContain('name="url"');
        expect(html).not.toContain("<style");
        expect(html).not.toContain("<script");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect(
    "GET / lists every server with its probe, a delete form each, and escapes the url",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        const odd = `${SERVER_A}/a"<b>`;
        fixed.store.servers.push(odd, SERVER_B);
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* http.get("/");
          expect(response.status).toBe(200);
          const html = yield* response.text;
          // A answers: its numbers; B does not: the one phrase.
          expect(html).toContain(`<td>${SERVER_A}/a&quot;&lt;b&gt;</td>`);
          expect(html).toContain("<td>2</td>");
          expect(html).toContain("<td>4.0 / 16.0 GB</td>");
          expect(html).toContain("<td>12.5%</td>");
          expect(html).toContain(`<td>${SERVER_B}</td>`);
          expect(html).toContain("did not answer");
          expect(html).not.toContain("<b>");
          expect(html).toContain('<form method="post" action="/servers/delete">');
          expect(html).toContain(
            `<input type="hidden" name="url" value="${SERVER_A}/a&quot;&lt;b&gt;">`,
          );
          expect(html).toContain(`<input type="hidden" name="url" value="${SERVER_B}">`);
          expect(html.match(/<button>delete<\/button>/g)).toHaveLength(2);
          expect(html).not.toContain("no servers registered");
        }).pipe(Effect.provide(serve(fixed)));
        // Both were probed; the odd url's probe is percent-encoded by the client, so only B's is pinned.
        expect(fixed.upstream.requests).toHaveLength(2);
        expect(fixed.upstream.requests.map((request) => request.url)).toContain(
          `${SERVER_B}/stats`,
        );
        expect(fixed.log.lines).toEqual([]);
      }),
  );

  it.effect("anything but the three routes is 404 not found and never logged", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const response of [
          yield* http.get("/nope"),
          yield* http.get("/servers"),
          yield* http.del("/servers", { body: form(SERVER_A) }),
          yield* http.post("/", { body: form(SERVER_A) }),
        ]) {
          expect(response.status).toBe(404);
          expect(yield* response.text).toBe("not found");
        }
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
      expect(fixed.upstream.requests).toEqual([]);
    }),
  );
});

describe("adding a server", () => {
  it.effect(
    "POST /servers probes the url, stores it, logs it and sends the browser back to /",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* http
            .post("/servers", { body: form(SERVER_A) })
            .pipe(manualRedirects);
          expect(response.status).toBe(303);
          expect(response.headers.location).toBe("/");
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.upstream.requests.map((request) => request.url)).toEqual([
          `${SERVER_A}/stats`,
        ]);
        expect(fixed.store.servers).toEqual([SERVER_A]);
        expect(FakeLog.texts(fixed.log)).toEqual([`server registered; ${SERVER_A}`]);
      }),
  );

  it.effect(
    "a url that is not http or https is the page again at 400 with the rule, unprobed",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        fixed.store.servers.push(SERVER_A);
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          for (const url of ["qemu.example.com:42069", "", "ftp://qemu.example.com"]) {
            const response = yield* http.post("/servers", { body: form(url) });
            expect(response.status, url).toBe(400);
            const html = yield* response.text;
            expect(html).toContain("<p>error: url must be an http or https url</p>");
            // The page is whole: the fleet and the add form are there under the error.
            expect(html).toContain(`<td>${SERVER_A}</td>`);
            expect(html).toContain('<form method="post" action="/servers">');
          }
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.store.servers).toEqual([SERVER_A]);
        // Rendering the page probed A three times; nothing else was probed.
        expect(fixed.upstream.requests.map((request) => request.url)).toEqual([
          `${SERVER_A}/stats`,
          `${SERVER_A}/stats`,
          `${SERVER_A}/stats`,
        ]);
        expect(fixed.log.lines.map((line) => [line.level, line.text, line.skipSentry])).toEqual([
          ["error", "POST /servers failed: url must be an http or https url", true],
          ["error", "POST /servers failed: url must be an http or https url", true],
          ["error", "POST /servers failed: url must be an http or https url", true],
        ]);
      }),
  );

  it.effect("a body that is not a form is 400 too", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/servers", {
          body: HttpBody.text('{"url":"http://10.0.0.5:42069"}', "application/json"),
        });
        expect(response.status).toBe(400);
        expect(yield* response.text).toContain("<p>error: url must be an http or https url</p>");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([]);
    }),
  );

  it.effect(
    "a server that does not answer is the page again at 502 with the reason, unstored",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(refused);
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* http.post("/servers", { body: form(SERVER_B) });
          expect(response.status).toBe(502);
          const html = yield* response.text;
          expect(html).toContain(
            `<p>error: server ${SERVER_B} unreachable: connect ECONNREFUSED 10.0.0.6:42069</p>`,
          );
          expect(html).toContain("no servers registered");
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.store.servers).toEqual([]);
        expect(fixed.log.lines).toHaveLength(1);
        expect(fixed.log.lines[0]).toMatchObject({
          level: "error",
          text: `POST /servers failed: server ${SERVER_B} unreachable: connect ECONNREFUSED 10.0.0.6:42069`,
          skipSentry: false,
        });
        expect(fixed.log.lines[0]?.cause).toBeInstanceOf(Error);
      }),
  );
});

describe("deleting a server", () => {
  it.effect("POST /servers/delete forgets the url, logs it and sends the browser back to /", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.store.servers.push(SERVER_A, SERVER_B);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http
          .post("/servers/delete", { body: form(SERVER_A) })
          .pipe(manualRedirects);
        expect(response.status).toBe(303);
        expect(response.headers.location).toBe("/");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([SERVER_B]);
      expect(fixed.upstream.requests).toEqual([]);
      expect(FakeLog.texts(fixed.log)).toEqual([`server removed; ${SERVER_A}`]);
    }),
  );

  it.effect("a url never registered is the page again at 404 saying so", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/servers/delete", { body: form(SERVER_A) });
        expect(response.status).toBe(404);
        expect(yield* response.text).toContain(`<p>error: ${SERVER_A} is not registered</p>`);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => [line.text, line.skipSentry])).toEqual([
        [`POST /servers/delete failed: ${SERVER_A} is not registered`, true],
      ]);
    }),
  );
});

describe("failures of the page itself", () => {
  it.effect(
    "a database failure is the page's 500 internal error, logged with the driver's reason",
    () =>
      Effect.gen(function* () {
        const failure = Errors.DatabaseError.make({
          operation: "listServers",
          message: "Failed query: select from servers",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        const fixed = fixture(fleet, {
          store: Stores.fakeServerStore({ listServers: () => Effect.fail(failure) }),
        });
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* http.get("/");
          expect(response.status).toBe(500);
          expect(response.headers["content-type"]).toContain("text/html");
          const html = yield* response.text;
          expect(html).toContain("<h1>oligarchy reverse proxy</h1>");
          expect(html).toContain("<p>error: internal error</p>");
          expect(html).not.toContain("5432");
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "GET / failed: connect ECONNREFUSED 127.0.0.1:5432",
            sessionId: undefined,
            agentId: undefined,
            skipSentry: false,
            cause: failure,
          },
        ]);
      }),
  );

  it.effect("a defect is the page's 500 internal error, logged with the pretty cause", () =>
    Effect.gen(function* () {
      const defect = new Error("boom");
      const fixed = fixture(fleet, {
        store: Stores.fakeServerStore({ listServers: () => Effect.die(defect) }),
      });
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.get("/");
        expect(response.status).toBe(500);
        expect(yield* response.text).toContain("<p>error: internal error</p>");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toHaveLength(1);
      expect(fixed.log.lines[0]?.text).toMatch(/^GET \/ failed: /);
      expect(fixed.log.lines[0]?.text).toContain("Error: boom");
      expect(fixed.log.lines[0]?.cause).toBe(defect);
    }),
  );
});
