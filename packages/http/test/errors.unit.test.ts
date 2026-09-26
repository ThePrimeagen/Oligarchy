import { describe, expect, it } from "vitest";
import { ErrorReporter, Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";
import * as Errors from "../src/errors.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const AGENT_ID = "OLI-61";

type WireCase = {
  readonly name: string;
  readonly wire: Schema.Codec<Errors.ApiError, { readonly error: string }>;
  readonly error: Errors.ApiError;
  readonly status: number;
};

const cases: ReadonlyArray<WireCase> = [
  {
    name: "BadRequest",
    wire: Errors.BadRequestWire,
    error: Errors.BadRequest.make({ message: "session id is required", agentId: AGENT_ID }),
    status: 400,
  },
  {
    name: "Unauthorized",
    wire: Errors.UnauthorizedWire,
    error: Errors.Unauthorized.make({ message: "unauthorized" }),
    status: 401,
  },
  {
    name: "Forbidden",
    wire: Errors.ForbiddenWire,
    error: Errors.Forbidden.make({
      message: `agent "${AGENT_ID}" does not own session "${SESSION_ID}"`,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
    }),
    status: 403,
  },
  {
    name: "UnknownSession",
    wire: Errors.UnknownSessionWire,
    error: Errors.unknownSession(SESSION_ID, AGENT_ID),
    status: 404,
  },
  {
    name: "NotFound",
    wire: Errors.NotFoundWire,
    error: Errors.NotFound.make({ message: "not found" }),
    status: 404,
  },
  {
    name: "NotFound naming a server",
    wire: Errors.NotFoundWire,
    error: Errors.NotFound.make({ message: "no server http://10.0.0.7:42069" }),
    status: 404,
  },
  {
    name: "Conflict",
    wire: Errors.ConflictWire,
    error: Errors.Conflict.make({
      message: `session "${SESSION_ID}" is not running on this qemu server`,
      sessionId: SESSION_ID,
    }),
    status: 409,
  },
  {
    name: "StartFailed",
    wire: Errors.StartFailedWire,
    error: Errors.StartFailed.make({
      message: "qemu: handshake timeout",
      cause: new Error("qemu: handshake timeout"),
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
    }),
    status: 502,
  },
  {
    name: "ExchangeFailed",
    wire: Errors.ExchangeFailedWire,
    error: Errors.ExchangeFailed.make({
      message: "qemu: send-key timed out",
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
    }),
    status: 502,
  },
  {
    name: "SaveFailed",
    wire: Errors.SaveFailedWire,
    error: Errors.SaveFailed.make({
      message: "guest did not power off within 2 minutes",
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
    }),
    status: 502,
  },
  {
    name: "Internal",
    wire: Errors.InternalWire,
    error: Errors.Internal.make({
      message: "internal error",
      cause: new Error("ENOENT"),
      sessionId: SESSION_ID,
    }),
    status: 500,
  },
  {
    name: "ServerFailed",
    wire: Errors.ServerFailedWire,
    error: Errors.ServerFailed.make({
      message: "server http://10.0.0.5:42069 unreachable: connect ECONNREFUSED 10.0.0.5:42069",
      url: "http://10.0.0.5:42069",
      cause: new Error("connect ECONNREFUSED 10.0.0.5:42069"),
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
    }),
    status: 502,
  },
  {
    name: "NoServer",
    wire: Errors.NoServerWire,
    error: Errors.NoServer.make({ message: "no server registered", agentId: AGENT_ID }),
    status: 503,
  },
  {
    name: "RunFailed",
    wire: Errors.RunFailedWire,
    error: Errors.RunFailed.make({ message: "out of token credits" }),
    status: 500,
  },
  {
    name: "RunAborted",
    wire: Errors.RunAbortedWire,
    error: Errors.RunAborted.make({ agentId: AGENT_ID }),
    status: 409,
  },
  {
    name: "AtCapacity",
    wire: Errors.AtCapacityWire,
    error: Errors.AtCapacity.make({ message: "at capacity: max-jobs is 2", agentId: AGENT_ID }),
    status: 503,
  },
  {
    name: "SetupNeeded",
    wire: Errors.SetupNeededWire,
    error: Errors.SetupNeeded.make({
      message: "setup needed: max-jobs is 4",
      agentId: AGENT_ID,
    }),
    status: 409,
  },
];

describe("API error wire codecs", () => {
  it.each(cases)(
    "$name encodes to { error } and decodes back to an instance",
    ({ wire, error }) => {
      const encoded = Schema.encodeSync(wire)(error);
      expect(encoded).toEqual({ error: error.message });
      const decoded = Schema.decodeUnknownSync(wire)({ error: error.message });
      expect(decoded._tag).toBe(error._tag);
      expect(decoded.message).toBe(error.message);
    },
  );

  it.each(cases)(
    "$name carries status $status on the codec and the class",
    ({ wire, error, status }) => {
      expect(Errors.httpStatus(wire)).toBe(status);
      expect(Errors.apiStatus(error)).toBe(status);
    },
  );

  it("httpStatus reads the annotation HttpApiSchema.status sets and defaults to 500", () => {
    expect(Errors.httpStatus(Schema.String.pipe(HttpApiSchema.status(418)))).toBe(418);
    expect(Errors.httpStatus(Schema.String)).toBe(500);
  });

  it("NotFound says `not found` unless told what was not found", () => {
    expect(Errors.NotFound.make({}).message).toBe("not found");
    expect(Errors.NotFound.make({ message: "no server http://x:1" }).message).toBe(
      "no server http://x:1",
    );
  });

  it("refuses a wire body without an error string", () => {
    expect(() => Schema.decodeUnknownSync(Errors.BadRequestWire)({ message: "x" })).toThrow();
    expect(() => Schema.decodeUnknownSync(Errors.BadRequestWire)({ error: 1 })).toThrow();
  });
});

describe("Sentry policy", () => {
  it("marks every API error as ignored: the boundary log line is the one Sentry report", () => {
    for (const { error } of cases) {
      expect(ErrorReporter.isIgnored(error)).toBe(true);
    }
  });
});

describe("unknownSession", () => {
  it("builds today's message and keeps the id", () => {
    const error = Errors.unknownSession("nope");
    expect(error.message).toBe(`unknown session "nope"`);
    expect(error.id).toBe("nope");
    expect(error.agentId).toBeUndefined();
    expect(Errors.unknownSession("nope", AGENT_ID).agentId).toBe(AGENT_ID);
  });
});

describe("fixed messages", () => {
  it("RunAborted, Unauthorized and Internal fill their one message", () => {
    expect(Errors.RunAborted.make({}).message).toBe("run aborted");
    expect(Errors.Unauthorized.make({}).message).toBe("unauthorized");
    expect(Errors.Internal.make({ cause: new Error("ENOENT") }).message).toBe("internal error");
  });

  it("refuses any other text for a fixed message", () => {
    expect(() =>
      Schema.decodeUnknownSync(Errors.RunAborted)({ _tag: "RunAborted", message: "x" }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Errors.Unauthorized)({ _tag: "Unauthorized", message: "nope" }),
    ).toThrow();
  });
});
