import { createHmac } from "node:crypto";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Redacted } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation/handlers.ts";
import * as Api from "../../src/shared/api.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";

const WEBHOOK_SECRET = "whsec_test";
const RECORD = "/home/operator/automation-test";
const TICKET = "OLI-61";
const MODEL = "grok-4.6";

const SecretLive = Layer.succeed(Handlers.LinearWebhookSecret)(
  Handlers.LinearWebhookSecret.of(Redacted.make(WEBHOOK_SECRET)),
);

type Write = {
  readonly path: string;
  readonly data: string;
  readonly flag: FileSystem.OpenFlag | undefined;
};

type RecordFile = {
  readonly writes: Array<Write>;
  readonly layer: Layer.Layer<FileSystem.FileSystem>;
};

// A FileSystem that records every string written, or refuses each write as a file it may not open.
const recordFile = (refuse = false): RecordFile => {
  const writes: Array<Write> = [];
  const layer = FileSystem.layerNoop({
    writeFileString: (path, data, options) =>
      refuse
        ? Effect.fail(FakeFs.permissionDenied("open", path))
        : Effect.sync(() => {
            writes.push({ path, data, flag: options?.flag });
          }),
  });
  return { writes, layer };
};

type Fixture = {
  readonly file: RecordFile;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
};

const fixture = (file: RecordFile = recordFile()): Fixture => ({
  file,
  log: FakeLog.fakeLog(),
  reporter: Reporter.collect(),
});

const serve = (fixed: Fixture) =>
  HttpRouter.serve(Handlers.routes(RECORD), { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(Layer.mergeAll(fixed.file.layer, fixed.log.layer, SecretLive)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
  );

const client = HttpApiClient.make(Api.AutomationApi);

const body = (ticket: string, model: string) => Contract.AutomateBody.make({ ticket, model });

const sign = (payload: string): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

const webhook = (http: HttpClient.HttpClient, payload: string, signature?: string) =>
  http.post("/linear", {
    headers:
      signature === undefined
        ? { "content-type": "application/json" }
        : { "content-type": "application/json", "linear-signature": signature },
    body: HttpBody.text(payload, "application/json"),
  });

describe("POST /automate", () => {
  it.effect("appends the ticket and the model to the record file, answers ok and logs it", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [ok, response] = yield* api.Automations.automate({
          payload: body(TICKET, MODEL),
          responseMode: "decoded-and-response",
        });
        expect(ok).toEqual(Contract.Ok.make({}));
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes).toEqual([
        { path: RECORD, data: `linear ticket ${TICKET}; model ${MODEL}\n`, flag: "a" },
      ]);
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: `automation recorded; ${MODEL}`,
          sessionId: undefined,
          agentId: TICKET,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("every request appends its own line, in order, and overwrites nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        yield* api.Automations.automate({ payload: body("OLI-1", "grok-4.6-high") });
        yield* api.Automations.automate({ payload: body("OLI-2", "claude-opus-5") });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes.map((write) => [write.data, write.flag])).toEqual([
        ["linear ticket OLI-1; model grok-4.6-high\n", "a"],
        ["linear ticket OLI-2; model claude-opus-5\n", "a"],
      ]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        "automation recorded; grok-4.6-high",
        "automation recorded; claude-opus-5",
      ]);
    }),
  );
});

describe("POST /automate refusals", () => {
  it.effect("a malformed body, a missing field and an empty one are 400 and record nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const malformed = yield* http.post("/automate", {
          body: HttpBody.text("{bad", "application/json"),
        });
        expect(malformed.status).toBe(400);
        expect(yield* malformed.json).toEqual({ error: "Expected a valid JSON body" });
        const noModel = yield* http.post("/automate", {
          body: HttpBody.jsonUnsafe({ ticket: TICKET }),
        });
        expect(noModel.status).toBe(400);
        expect(yield* noModel.json).toMatchObject({
          error: expect.stringContaining('["model"]'),
        });
        const noTicket = yield* http.post("/automate", {
          body: HttpBody.jsonUnsafe({ model: MODEL }),
        });
        expect(noTicket.status).toBe(400);
        expect(yield* noTicket.json).toMatchObject({
          error: expect.stringContaining('["ticket"]'),
        });
        const emptyTicket = yield* http.post("/automate", {
          body: HttpBody.jsonUnsafe({ ticket: "", model: MODEL }),
        });
        expect(emptyTicket.status).toBe(400);
        expect(yield* emptyTicket.json).toMatchObject({
          error: expect.stringContaining('["ticket"]'),
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes).toEqual([]);
      expect(fixed.log.lines).toHaveLength(4);
      expect(fixed.log.lines[0]?.text).toBe("POST /automate failed: Expected a valid JSON body");
      expect(fixed.log.lines.every((line) => line.level === "error" && line.skipSentry)).toBe(true);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a ticket or model with a line break in it is 400 and records nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const ticket = yield* http.post("/automate", {
          body: HttpBody.jsonUnsafe({ ticket: "OLI-1\nlinear ticket OLI-2", model: MODEL }),
        });
        expect(ticket.status).toBe(400);
        const refusedTicket = yield* ticket.json;
        expect(refusedTicket).toMatchObject({ error: expect.stringContaining("line break") });
        expect(refusedTicket).toMatchObject({ error: expect.stringContaining('["ticket"]') });
        const model = yield* http.post("/automate", {
          body: HttpBody.jsonUnsafe({ ticket: TICKET, model: "grok-4.6\r\n" }),
        });
        expect(model.status).toBe(400);
        expect(yield* model.json).toMatchObject({ error: expect.stringContaining('["model"]') });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes).toEqual([]);
      expect(fixed.log.lines).toHaveLength(2);
      expect(fixed.log.lines.every((line) => line.level === "error" && line.skipSentry)).toBe(true);
    }),
  );

  it.effect(
    "a record file that cannot be written is 500 internal error, logged with Node's reason",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(recordFile(true));
        yield* Effect.gen(function* () {
          const api = yield* client;
          const error = yield* Effect.flip(
            api.Automations.automate({ payload: body(TICKET, MODEL) }),
          );
          expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
          const http = yield* HttpClient.HttpClient;
          const raw = yield* http.post("/automate", {
            body: HttpBody.jsonUnsafe({ ticket: TICKET, model: MODEL }),
          });
          expect(raw.status).toBe(500);
          expect(yield* raw.json).toEqual({ error: "internal error" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.file.writes).toEqual([]);
        expect(fixed.log.lines).toHaveLength(2);
        for (const line of fixed.log.lines) {
          expect(line).toMatchObject({
            level: "error",
            text: `POST /automate failed: EACCES: permission denied, open '${RECORD}'`,
            sessionId: undefined,
            agentId: TICKET,
            skipSentry: false,
          });
          expect(line.cause).toMatchObject({ _tag: "PlatformError" });
        }
        // The boundary's line is the one report; HttpApiBuilder's own is silenced.
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );

  it.effect(
    "GET /automate, GET /linear and anything unrouted are 404 not found and never logged",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          for (const path of ["/automate", "/linear", "/start", "/servers", "/nope"]) {
            const response = yield* http.get(path);
            expect(response.status, path).toBe(404);
            expect(yield* response.json).toEqual({ error: "not found" });
          }
          const start = yield* http.post("/start", {
            body: HttpBody.jsonUnsafe({ iso: "omarchy.iso", agent: TICKET }),
          });
          expect(start.status).toBe(404);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.file.writes).toEqual([]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );
});

describe("POST /linear", () => {
  const payload = '{"action":"update","type":"Issue","data":{"identifier":"OLI-1"}}';

  it.effect("appends the exact body Linear sent, answers ok and logs it", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* webhook(http, payload, sign(payload));
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes).toEqual([{ path: RECORD, data: `${payload}\n`, flag: "a" }]);
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: "linear webhook recorded",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("every signed delivery appends its own exact body, in order", () =>
    Effect.gen(function* () {
      const first = '{"action":"create","type":"Issue"}';
      const second = '{\n  "action": "update",\n  "type": "Comment"\n}';
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* webhook(http, first, sign(first))).status).toBe(200);
        expect((yield* webhook(http, second, sign(second))).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes.map((write) => write.data)).toEqual([`${first}\n`, `${second}\n`]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        "linear webhook recorded",
        "linear webhook recorded",
      ]);
    }),
  );
});

describe("POST /linear refusals", () => {
  const payload = '{"action":"update"}';

  it.effect(
    "a missing or wrong signature is 401 unauthorized, records nothing and logs one line each",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const missing = yield* webhook(http, payload);
          expect(missing.status).toBe(401);
          expect(yield* missing.json).toEqual({ error: "unauthorized" });
          const wrong = yield* webhook(http, payload, "00".repeat(32));
          expect(wrong.status).toBe(401);
          expect(yield* wrong.json).toEqual({ error: "unauthorized" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.file.writes).toEqual([]);
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /linear failed: unauthorized",
            sessionId: undefined,
            agentId: undefined,
            skipSentry: true,
            cause: undefined,
          },
          {
            level: "error",
            text: "POST /linear failed: unauthorized",
            sessionId: undefined,
            agentId: undefined,
            skipSentry: true,
            cause: undefined,
          },
        ]);
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );

  it.effect("a valid signature of a different body is 401 and records nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* webhook(http, payload, sign('{"action":"create"}'));
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes).toEqual([]);
    }),
  );

  it.effect(
    "a record file that cannot be written is 500 internal error, logged with Node's reason",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(recordFile(true));
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const raw = yield* webhook(http, payload, sign(payload));
          expect(raw.status).toBe(500);
          expect(yield* raw.json).toEqual({ error: "internal error" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.file.writes).toEqual([]);
        expect(fixed.log.lines).toHaveLength(1);
        expect(fixed.log.lines[0]).toMatchObject({
          level: "error",
          text: `POST /linear failed: EACCES: permission denied, open '${RECORD}'`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
        });
        expect(fixed.log.lines[0]?.cause).toMatchObject({ _tag: "PlatformError" });
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );
});
