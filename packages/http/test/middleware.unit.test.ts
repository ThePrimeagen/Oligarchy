import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Layer, PlatformError, Redacted } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Config from "@oligarchy/env/config";
import * as Log from "@oligarchy/log/log";
import * as Api from "../src/api.ts";
import * as Contract from "../src/contract.ts";
import * as ApiErrors from "../src/errors.ts";
import * as Middleware from "../src/middleware.ts";

const TOKEN = "test-token";
const SESSION = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const TICKET = "OLI-61";
const headers = { authorization: `Bearer ${TOKEN}` };

type Line = {
  readonly level: string;
  readonly text: string;
  readonly location: string | undefined;
  readonly agentId: string | undefined;
  readonly skipSentry: boolean;
  readonly cause: unknown;
};

// A Log that keeps every line, and what it was told about Sentry, instead of writing it.
const recordingLog = () => {
  const lines: Array<Line> = [];
  const record =
    (level: string) =>
    (text: string, report?: Log.Report): Effect.Effect<void> =>
      Effect.sync(() => {
        lines.push({
          level,
          text,
          location: report?.location,
          agentId: report?.agentId,
          skipSentry: report?.skipSentry === true,
          cause: report?.cause,
        });
      });
  return {
    lines,
    layer: Layer.succeed(Log.Log)(
      Log.Log.of({
        info: record("info"),
        warning: record("warning"),
        error: record("error"),
        fatal: record("fatal"),
        flush: Effect.void,
      }),
    ),
  };
};

type Refusal = ApiErrors.BadRequest | ApiErrors.Internal;
type Answers = {
  readonly reserve?: Effect.Effect<
    Contract.Ok,
    ApiErrors.AtCapacity | ApiErrors.SetupNeeded | Refusal
  >;
  readonly run?: Effect.Effect<Contract.Ok, ApiErrors.RunAborted | ApiErrors.RunFailed | Refusal>;
  readonly abort?: Effect.Effect<
    Contract.Ok,
    ApiErrors.UnknownSession | ApiErrors.RunFailed | Refusal
  >;
};

// The automation client's small api, each route answering what the test says and counting calls,
// behind the middleware under test.
const serve = (
  answers: Answers = {},
  options: {
    readonly auth?: Layer.Layer<Api.BearerAuth, never, Config.ProxyConfig>;
    readonly attribution?: Log.ProcessAttribution;
  } = {},
) => {
  const log = recordingLog();
  const calls: Array<string> = [];
  const answer = <E>(name: string, value: Effect.Effect<Contract.Ok, E> | undefined) =>
    Effect.suspend(() => {
      calls.push(name);
      return value ?? Effect.succeed(Contract.Ok.make({}));
    });
  const runs = HttpApiBuilder.group(Api.AutomationClientApi, "Runs", (handlers) =>
    handlers
      .handle("reserve", () => answer("reserve", answers.reserve))
      .handle("run", () => answer("run", answers.run))
      .handle("abort", () => answer("abort", answers.abort)),
  );
  const routes = Layer.mergeAll(
    HttpApiBuilder.layer(Api.AutomationClientApi).pipe(
      Layer.provide(runs),
      Layer.provide(
        Layer.mergeAll(
          options.auth ?? Middleware.bearerAuth(Redacted.make(TOKEN)),
          Middleware.ApiBoundaryLive,
        ),
      ),
    ),
    Middleware.NotFoundRoute,
  );
  const layer = HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(log.layer),
    Layer.provide(
      Layer.succeed(Log.ProcessAttribution)(
        options.attribution ?? Log.ProcessAttribution.defaultValue(),
      ),
    ),
    Layer.provide(
      Layer.succeed(Config.ProxyConfig)({
        token: Redacted.make("config-token"),
        databaseUrl: Redacted.make("postgres://unused"),
      }),
    ),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return { log, calls, layer };
};

const reserve = { ticket: TICKET, action: "drive" };

const post = (path: string, body: unknown, extra: Record<string, string> = headers) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.post(path, { headers: extra, body: HttpBody.jsonUnsafe(body) });
    return { status: response.status, body: yield* response.json };
  });

describe("bearer auth happy path", () => {
  it.effect("the exact token is accepted with any scheme casing, and nothing is logged", () =>
    Effect.gen(function* () {
      const server = serve();
      const answered = yield* Effect.all([
        post("/reserve", reserve),
        post("/reserve", reserve, { authorization: `bearer ${TOKEN}` }),
      ]).pipe(Effect.provide(server.layer));
      expect(answered.map((response) => response.status)).toEqual([200, 200]);
      expect(server.calls).toEqual(["reserve", "reserve"]);
      expect(server.log.lines).toEqual([]);
    }),
  );

  it.effect("BearerAuthLive takes the token from ProxyConfig", () =>
    Effect.gen(function* () {
      const server = serve({}, { auth: Middleware.BearerAuthLive });
      const answered = yield* post("/reserve", reserve, {
        authorization: "Bearer config-token",
      }).pipe(Effect.provide(server.layer));
      expect(answered.status).toBe(200);
    }),
  );
});

describe("bearer auth unhappy path", () => {
  it.effect(
    "a missing bearer, a wrong one, another scheme and a bare token are 401, one line each, before the route",
    () =>
      Effect.gen(function* () {
        const server = serve();
        const answered = yield* Effect.all([
          post("/reserve", reserve, {}),
          post("/run", { prompt: "p", ticket: TICKET }, { authorization: "Bearer wrong" }),
          post("/abort", { ticket: TICKET }, { authorization: "Basic dGVzdC10b2tlbg==" }),
          post("/abort", { ticket: TICKET }, { authorization: TOKEN }),
        ]).pipe(Effect.provide(server.layer));
        expect(answered).toEqual(
          Array.from({ length: 4 }, () => ({ status: 401, body: { error: "unauthorized" } })),
        );
        expect(server.calls).toEqual([]);
        expect(server.log.lines).toEqual(
          ["POST /reserve", "POST /run", "POST /abort", "POST /abort"].map((request) => ({
            level: "error",
            text: `${request} failed: unauthorized`,
            location: "server",
            agentId: undefined,
            skipSentry: true,
            cause: undefined,
          })),
        );
      }),
  );

  it.effect("BearerAuthLive refuses any token but the configured one", () =>
    Effect.gen(function* () {
      const server = serve({}, { auth: Middleware.BearerAuthLive });
      const answered = yield* post("/reserve", reserve).pipe(Effect.provide(server.layer));
      expect(answered.status).toBe(401);
      expect(server.calls).toEqual([]);
    }),
  );
});

describe("boundary happy path", () => {
  it.effect(
    "a declared refusal keeps its status and message, logged once under the agent and kept from Sentry",
    () =>
      Effect.gen(function* () {
        const server = serve({
          reserve: Effect.fail(
            ApiErrors.SetupNeeded.make({ message: "setup needed", agentId: TICKET }),
          ),
        });
        const answered = yield* post("/reserve", reserve).pipe(Effect.provide(server.layer));
        expect(answered).toEqual({ status: 409, body: { error: "setup needed" } });
        expect(server.log.lines).toEqual([
          {
            level: "error",
            text: "POST /reserve failed: setup needed",
            location: "server",
            agentId: TICKET,
            skipSentry: true,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect("a full machine's 503 is an answer, kept from Sentry", () =>
    Effect.gen(function* () {
      const server = serve({
        reserve: Effect.fail(ApiErrors.AtCapacity.make({ message: "at capacity: max-jobs is 2" })),
      });
      const answered = yield* post("/reserve", reserve).pipe(Effect.provide(server.layer));
      expect(answered).toEqual({ status: 503, body: { error: "at capacity: max-jobs is 2" } });
      expect(server.log.lines).toMatchObject([{ skipSentry: true, cause: undefined }]);
    }),
  );

  it.effect(
    "an unknown session is filed under its id when it is one this server could mint, else under the process",
    () =>
      Effect.gen(function* () {
        const unknown = (id: string) =>
          serve({
            abort: Effect.fail(
              ApiErrors.UnknownSession.make({ id, message: "unknown", agentId: TICKET }),
            ),
          });
        const minted = unknown(SESSION);
        const foreign = unknown("nope");
        yield* post("/abort", { ticket: TICKET }).pipe(Effect.provide(minted.layer));
        yield* post("/abort", { ticket: TICKET }).pipe(Effect.provide(foreign.layer));
        expect(
          [...minted.log.lines, ...foreign.log.lines].map((line) => [line.location, line.agentId]),
        ).toEqual([
          [SESSION, TICKET],
          ["server", TICKET],
        ]);
      }),
  );

  it.effect("a line with no agent of its own takes the process's", () =>
    Effect.gen(function* () {
      const server = serve(
        { run: Effect.fail(ApiErrors.RunFailed.make({ message: "driver exited 1" })) },
        { attribution: Log.AutomationProcessAttribution },
      );
      const answered = yield* post("/run", { prompt: "p", ticket: TICKET }).pipe(
        Effect.provide(server.layer),
      );
      expect(answered).toEqual({ status: 500, body: { error: "driver exited 1" } });
      expect(server.log.lines).toMatchObject([
        {
          text: "POST /run failed: driver exited 1",
          location: "automation",
          agentId: "automation",
        },
      ]);
    }),
  );

  it.effect("the catch-all is 404 not found for any other path or method, never logged", () =>
    Effect.gen(function* () {
      const server = serve();
      const statuses = yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const nope = yield* http.get("/nope", { headers });
        const wrongMethod = yield* http.get("/reserve");
        return [
          [nope.status, yield* nope.json],
          [wrongMethod.status, yield* wrongMethod.json],
        ];
      }).pipe(Effect.provide(server.layer));
      expect(statuses).toEqual([
        [404, { error: "not found" }],
        [404, { error: "not found" }],
      ]);
      expect(server.log.lines).toEqual([]);
      expect(server.calls).toEqual([]);
    }),
  );
});

describe("boundary unhappy path", () => {
  it.effect("a malformed body and a body failing the schema are 400 before the route", () =>
    Effect.gen(function* () {
      const server = serve();
      const answered = yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const malformed = yield* http.post("/reserve", {
          headers,
          body: HttpBody.text("{bad", "application/json"),
        });
        return [
          { status: malformed.status, body: yield* malformed.json },
          yield* post("/reserve", { action: "drive" }),
        ];
      }).pipe(Effect.provide(server.layer));
      expect(answered[0]).toEqual({ status: 400, body: { error: "Expected a valid JSON body" } });
      expect(answered[1]).toMatchObject({
        status: 400,
        body: { error: expect.stringContaining('["ticket"]') },
      });
      expect(server.calls).toEqual([]);
      expect(server.log.lines.map((line) => [line.text.split(":")[0], line.skipSentry])).toEqual([
        ["POST /reserve failed", true],
        ["POST /reserve failed", true],
      ]);
    }),
  );

  it.effect(
    "an Internal is 500 internal error, its line the reason one level down, its cause handed to Sentry",
    () =>
      Effect.gen(function* () {
        const platform = PlatformError.systemError({
          _tag: "NotFound",
          module: "FileSystem",
          method: "readFile",
          pathOrDescriptor: "/tmp/serial.log",
          cause: new Error("ENOENT: no such file or directory, open '/tmp/serial.log'"),
        });
        const bare = new Error("pool ended");
        const server = serve({
          run: Effect.fail(ApiErrors.Internal.make({ message: "internal error", cause: platform })),
          abort: Effect.fail(ApiErrors.Internal.make({ message: "internal error", cause: bare })),
        });
        const answered = yield* Effect.all([
          post("/run", { prompt: "p", ticket: TICKET }),
          post("/abort", { ticket: TICKET }),
        ]).pipe(Effect.provide(server.layer));
        expect(answered).toEqual([
          { status: 500, body: { error: "internal error" } },
          { status: 500, body: { error: "internal error" } },
        ]);
        expect(server.log.lines).toEqual([
          {
            level: "error",
            text: "POST /run failed: ENOENT: no such file or directory, open '/tmp/serial.log'",
            location: "server",
            agentId: undefined,
            skipSentry: false,
            cause: platform,
          },
          {
            level: "error",
            text: "POST /abort failed: pool ended",
            location: "server",
            agentId: undefined,
            skipSentry: false,
            cause: bare,
          },
        ]);
      }),
  );

  it.effect("a second reserve for a held id is this process breaking its contract: reported", () =>
    Effect.gen(function* () {
      const server = serve({
        reserve: Effect.fail(
          ApiErrors.BadRequest.make({ message: "already reserved", agentId: TICKET }),
        ),
        run: Effect.fail(ApiErrors.BadRequest.make({ message: "no reservation", agentId: TICKET })),
      });
      yield* Effect.all([
        post("/reserve", reserve),
        post("/run", { prompt: "p", ticket: TICKET }),
      ]).pipe(Effect.provide(server.layer));
      expect(server.log.lines.map((line) => [line.text, line.skipSentry])).toEqual([
        ["POST /reserve failed: already reserved", false],
        ["POST /run failed: no reservation", true],
      ]);
    }),
  );

  it.effect(
    "a defect is 500 internal error, its line the pretty cause, the defect handed to Sentry",
    () =>
      Effect.gen(function* () {
        const defect = new Error("boom");
        const server = serve({ reserve: Effect.die(defect) });
        const answered = yield* post("/reserve", reserve).pipe(Effect.provide(server.layer));
        expect(answered).toEqual({ status: 500, body: { error: "internal error" } });
        expect(server.log.lines).toEqual([
          {
            level: "error",
            text: `POST /reserve failed: ${Cause.pretty(Cause.die(defect))}`,
            location: "server",
            agentId: undefined,
            skipSentry: false,
            cause: defect,
          },
        ]);
      }),
  );
});
