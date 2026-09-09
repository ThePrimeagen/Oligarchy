import { createHmac } from "node:crypto";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Redacted } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation/handlers.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";

const WEBHOOK_SECRET = "whsec_test";
const RECORD = "./automation-logs";

const SecretLive = Layer.succeed(Handlers.LinearWebhookSecret)(
  Handlers.LinearWebhookSecret.of(Redacted.make(WEBHOOK_SECRET)),
);

type Write = {
  readonly path: string;
  readonly data: Uint8Array;
  readonly flag: FileSystem.OpenFlag | undefined;
};

type RecordFile = {
  readonly writes: Array<Write>;
  readonly layer: Layer.Layer<FileSystem.FileSystem>;
};

const denied = (path: string) => Effect.fail(FakeFs.permissionDenied("open", path));

// A FileSystem that records every write, or refuses each one as a file it may not open.
const recordFile = (refuse = false): RecordFile => {
  const writes: Array<Write> = [];
  const layer = FileSystem.layerNoop({
    writeFile: (path, data, options) =>
      refuse
        ? denied(path)
        : Effect.sync(() => {
            writes.push({ path, data, flag: options?.flag });
          }),
  });
  return { writes, layer };
};

const withNewline = (payload: string | Uint8Array): Uint8Array => {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = 0x0a;
  return out;
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

const sign = (payload: string | Uint8Array): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

const webhook = (http: HttpClient.HttpClient, payload: string | Uint8Array, signature?: string) =>
  http.post("/linear", {
    headers:
      signature === undefined
        ? { "content-type": "application/json" }
        : { "content-type": "application/json", "linear-signature": signature },
    body:
      typeof payload === "string"
        ? HttpBody.text(payload, "application/json")
        : HttpBody.uint8Array(payload, "application/json"),
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
      expect(fixed.file.writes).toEqual([{ path: RECORD, data: withNewline(payload), flag: "a" }]);
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
      expect(fixed.file.writes.map((write) => write.data)).toEqual([
        withNewline(first),
        withNewline(second),
      ]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        "linear webhook recorded",
        "linear webhook recorded",
      ]);
    }),
  );

  it.effect("logs the ticket and the state name when Linear sent an Issue with both", () =>
    Effect.gen(function* () {
      const body = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          identifier: "OLI-1063",
          state: {
            id: "a9fe2d89-3cb3-47dd-8645-5d224f997134",
            name: "Automation Needed",
            type: "unstarted",
          },
        },
        updatedFrom: { state: { name: "Todo" } },
      });
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* webhook(http, body, sign(body))).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.file.writes).toEqual([{ path: RECORD, data: withNewline(body), flag: "a" }]);
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: "linear webhook recorded; Automation Needed",
          sessionId: undefined,
          agentId: "OLI-1063",
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect(
    "appends a UTF-8 BOM body as the exact bytes Linear signed, plus a trailing newline",
    () =>
      Effect.gen(function* () {
        const bom = new Uint8Array([
          0xef,
          0xbb,
          0xbf,
          ...new TextEncoder().encode('{"action":"update"}'),
        ]);
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* webhook(http, bom, sign(bom));
          expect(response.status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.file.writes).toEqual([{ path: RECORD, data: withNewline(bom), flag: "a" }]);
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

  it.effect(
    "POST /automate, GET /linear and anything unrouted are 404 not found and never logged",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const automate = yield* http.post("/automate", {
            body: HttpBody.jsonUnsafe({ ticket: "OLI-61", model: "grok-4.6" }),
          });
          expect(automate.status).toBe(404);
          expect(yield* automate.json).toEqual({ error: "not found" });
          for (const path of ["/automate", "/linear", "/start", "/servers", "/nope"]) {
            const response = yield* http.get(path);
            expect(response.status, path).toBe(404);
            expect(yield* response.json).toEqual({ error: "not found" });
          }
          const start = yield* http.post("/start", {
            body: HttpBody.jsonUnsafe({ iso: "omarchy.iso", agent: "OLI-61" }),
          });
          expect(start.status).toBe(404);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.file.writes).toEqual([]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );
});
