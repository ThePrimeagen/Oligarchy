import { describe, expect, it } from "vitest";
import { ErrorReporter, Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";
import * as Errors from "../../src/shared/errors.ts";

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
    name: "Conflict",
    wire: Errors.ConflictWire,
    error: Errors.Conflict.make({
      message: `session "${SESSION_ID}" is not running on this proxy`,
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
    name: "Internal",
    wire: Errors.InternalWire,
    error: Errors.Internal.make({
      message: "internal error",
      cause: new Error("ENOENT"),
      sessionId: SESSION_ID,
    }),
    status: 500,
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

  it("refuses a wire body without an error string", () => {
    expect(() => Schema.decodeUnknownSync(Errors.BadRequestWire)({ message: "x" })).toThrow();
    expect(() => Schema.decodeUnknownSync(Errors.BadRequestWire)({ error: 1 })).toThrow();
  });

  it("apiStatus agrees with getStatusErrorSchema for every class", () => {
    const classes = [
      Errors.BadRequest,
      Errors.Unauthorized,
      Errors.Forbidden,
      Errors.UnknownSession,
      Errors.NotFound,
      Errors.Conflict,
      Errors.StartFailed,
      Errors.ExchangeFailed,
      Errors.Internal,
    ];
    const statuses = classes.map((klass) => Errors.httpStatus(klass));
    expect(statuses).toEqual([400, 401, 403, 404, 404, 409, 502, 502, 500]);
    expect(cases.map(({ error }) => Errors.apiStatus(error))).toEqual(statuses);
  });
});

describe("Sentry policy", () => {
  it("marks every API error as ignored: the boundary log line is the one Sentry report", () => {
    for (const { error } of cases) {
      expect(ErrorReporter.isIgnored(error)).toBe(true);
    }
  });

  it("attributes carry session_id and agent_id only when present", () => {
    expect(
      ErrorReporter.getAttributes(
        Errors.BadRequest.make({ message: "x", sessionId: SESSION_ID, agentId: AGENT_ID }),
      ),
    ).toEqual({ session_id: SESSION_ID, agent_id: AGENT_ID });
    expect(ErrorReporter.getAttributes(Errors.BadRequest.make({ message: "x" }))).toEqual({});
    expect(
      ErrorReporter.getAttributes(Errors.Conflict.make({ message: "x", sessionId: SESSION_ID })),
    ).toEqual({ session_id: SESSION_ID });
    expect(
      ErrorReporter.getAttributes(
        Errors.Internal.make({ message: "internal error", cause: 1, agentId: AGENT_ID }),
      ),
    ).toEqual({ agent_id: AGENT_ID });
  });

  it("drops a non-uuid UnknownSession id from the attributes", () => {
    expect(ErrorReporter.getAttributes(Errors.unknownSession("garbage", AGENT_ID))).toEqual({
      agent_id: AGENT_ID,
    });
    expect(ErrorReporter.getAttributes(Errors.unknownSession(SESSION_ID))).toEqual({
      session_id: SESSION_ID,
    });
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

describe("domain error messages", () => {
  it("MissingVariable renders <NAME> is not set", () => {
    expect(Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" }).message).toBe(
      "OLIGARCHY_TOKEN is not set",
    );
    expect(String(Errors.MissingVariable.make({ name: "X" }))).toContain("X is not set");
  });

  it("QmpTimeout names the command", () => {
    expect(Errors.QmpTimeout.make({ command: "send-key" }).message).toBe(
      "qemu: send-key timed out",
    );
  });

  it("QmpError renders class: desc and keeps the raw frame", () => {
    const raw = { error: { class: "GenericError", desc: "boom" }, id: 1 };
    const error = Errors.QmpError.make({
      command: "send-key",
      class: "GenericError",
      desc: "boom",
      raw,
    });
    expect(error.message).toBe("GenericError: boom");
    expect(error.raw).toEqual(raw);
  });

  it("HostRequirementsMissing joins the list with newlines", () => {
    expect(
      Errors.HostRequirementsMissing.make({
        missing: ["qemu-system-x86_64 not on PATH", "OVMF code not found: /x"],
      }).message,
    ).toBe("missing host requirements:\nqemu-system-x86_64 not on PATH\nOVMF code not found: /x");
  });

  it("ChildExit renders its stderr", () => {
    expect(
      Errors.ChildExit.make({ command: "client", code: 1, stderr: "OLIGARCHY_TOKEN is not set" })
        .message,
    ).toBe("OLIGARCHY_TOKEN is not set");
  });

  it("DatabaseError keeps the driver message and an optional cause", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const error = Errors.DatabaseError.make({
      operation: "insertLog",
      message: "Failed query: insert into logs",
      cause,
    });
    expect(error.message).toBe("Failed query: insert into logs");
    expect(error.cause).toBe(cause);
    expect(Errors.DatabaseError.make({ operation: "ping", message: "x" }).cause).toBeUndefined();
  });

  it("every class carries its short tag", () => {
    expect(Errors.CommandError.make({ message: "x" })._tag).toBe("CommandError");
    expect(Errors.QmpClosed.make({ message: "qemu: closed" })._tag).toBe("QmpClosed");
    expect(Errors.QmpProtocolError.make({ message: "x" })._tag).toBe("QmpProtocolError");
    expect(Errors.QemuStartError.make({ message: "x" })._tag).toBe("QemuStartError");
    expect(Errors.IsoError.make({ message: "x" })._tag).toBe("IsoError");
    expect(Errors.KeysError.make({ message: "x" })._tag).toBe("KeysError");
    expect(Errors.ProxyRefusal.make({ status: 409, message: "x" })._tag).toBe("ProxyRefusal");
    expect(Errors.ProxyUnreachable.make({ message: "x", cause: 1 })._tag).toBe("ProxyUnreachable");
    expect(Errors.LinearError.make({ operation: "team", message: "x" })._tag).toBe("LinearError");
    expect(Errors.CursorAgentFailed.make({ message: "x", retryable: false, cause: 1 })._tag).toBe(
      "CursorAgentFailed",
    );
    expect(Errors.PngDecodeError.make({ message: "x" })._tag).toBe("PngDecodeError");
  });
});
