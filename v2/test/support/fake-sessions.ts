import {
  type Cause,
  Effect,
  Layer,
  Option,
  type Queue,
  Ref,
  Scope,
  Stream,
  type Tracer,
} from "effect";
import * as Sessions from "../../src/proxy/sessions.ts";
import * as Contract from "../../src/shared/contract.ts";
import type * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";

// The ids Sessions mints come from crypto.randomUUID(), whose type is this template.
type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
export const AGENT_ID = "OLI-61";
export const OTHER_AGENT_ID = "OLI-99";
export const STARTED_ID: Uuid = "8f4e2c1a-6b7d-4e5f-9a0b-1c2d3e4f5a6b";
export const IMAGE_ID: Uuid = "3c9b2f80-5a1e-4d6c-8b7a-9e0f1a2b3c4d";
export const PNG: Uint8Array = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
export const SERIAL: Uint8Array = new TextEncoder().encode("omarchy login: ");
export const DUMP: Uint8Array = new TextEncoder().encode("[    0.000000] Linux version 6.12\n");
export const FOLLOW_EVENTS: ReadonlyArray<Domain.FollowEvent> = [
  { type: "session", status: "running" },
  { type: "action", id: 1, name: "send-keys", state: "running" },
  { type: "session", status: "succeeded" },
];
export const STATS: Contract.Stats = Contract.Stats.make({
  qemus: 1,
  memory: Contract.Memory.make({ totalBytes: 16_000, usedBytes: 4_000, freeBytes: 12_000 }),
  cpu: Contract.Cpu.make({ cores: 4, mean: 20.5, p10: 19.8, p25: 20.1, p75: 20.9, p90: 21.1 }),
});

export type Call = { readonly method: string; readonly args: ReadonlyArray<unknown> };

export type FakeSessions = {
  readonly calls: Array<Call>;
  readonly layer: Layer.Layer<Sessions.Sessions>;
};

const die = (member: string) => () => Effect.die(`Unexpected QemuHandle.${member}`);

// A LiveSession the handlers can thread through; its fields are never read by them.
const liveSession = (id: string, agent: string): Effect.Effect<Sessions.LiveSession> =>
  Effect.gen(function* () {
    const span = yield* Effect.makeSpan("fake session");
    const dir = `/tmp/oligarchy-${id}`;
    return {
      id,
      agent,
      qemu: {
        id,
        dir,
        serialPath: `${dir}/serial.log`,
        sendKeys: die("sendKeys"),
        sendMouse: die("sendMouse"),
        screendump: die("screendump"),
      },
      span,
      scope: Scope.makeUnsafe(),
      lastCommandAt: Ref.makeUnsafe(0),
      intent: Ref.makeUnsafe<
        Option.Option<{ readonly span: Tracer.Span; readonly message: string }>
      >(Option.none()),
      image: Ref.makeUnsafe<Option.Option<{ readonly id: string; readonly png: string }>>(
        Option.none(),
      ),
      followers: Ref.makeUnsafe<ReadonlySet<Queue.Queue<Domain.FollowEvent, Cause.Done>>>(
        new Set(),
      ),
      actionSeq: Ref.makeUnsafe(0),
      actionSpans: Ref.makeUnsafe<ReadonlySet<Tracer.Span>>(new Set()),
    };
  });

// A Sessions service holding one live session (SESSION_ID owned by AGENT_ID) whose methods
// record their calls and answer with the fixtures above; `overrides` script failures.
export const fakeSessions = (
  overrides: Partial<Sessions.SessionsService> = {},
  live: ReadonlyArray<{ readonly id: string; readonly agent: string }> = [
    { id: SESSION_ID, agent: AGENT_ID },
  ],
): FakeSessions => {
  const calls: Array<Call> = [];
  const record = (method: string, ...args: ReadonlyArray<unknown>) =>
    Effect.sync(() => {
      calls.push({ method, args });
    });
  const layer = Layer.effect(Sessions.Sessions)(
    Effect.gen(function* () {
      const sessions = new Map<string, Sessions.LiveSession>();
      for (const { id, agent } of live) {
        sessions.set(id, yield* liveSession(id, agent));
      }
      const lookup = (
        id: string,
        agent: string,
      ): Effect.Effect<
        Sessions.LiveSession,
        Errors.BadRequest | Errors.UnknownSession | Errors.Forbidden
      > =>
        Effect.gen(function* () {
          yield* record("lookup", id, agent);
          if (id === "") {
            return yield* Errors.BadRequest.make({
              message: "session id is required",
              agentId: agent,
            });
          }
          const found = sessions.get(id);
          if (found === undefined) {
            return yield* Errors.unknownSession(id, agent);
          }
          if (found.agent !== agent) {
            return yield* Errors.Forbidden.make({
              message: `agent "${agent}" does not own session "${id}"`,
              sessionId: id,
              agentId: agent,
            });
          }
          return found;
        });
      const known = (
        method: string,
        id: string,
      ): Effect.Effect<Sessions.LiveSession, Errors.UnknownSession> =>
        Effect.gen(function* () {
          yield* record(method, id);
          const found = sessions.get(id);
          return found === undefined ? yield* Errors.unknownSession(id) : found;
        });
      return Sessions.Sessions.of({
        start: (body, display, automation) =>
          record("start", body, display, automation).pipe(Effect.as(STARTED_ID)),
        lookup,
        image: (session) =>
          record("image", session.id).pipe(Effect.as({ png: PNG, imageId: IMAGE_ID })),
        serial: (session) => record("serial", session.id).pipe(Effect.as(SERIAL)),
        dump: (id) => known("dump", id).pipe(Effect.as(DUMP)),
        sendKeys: (session, keys, encoding) => record("sendKeys", session.id, keys, encoding),
        sendMouse: (session, input) => record("sendMouse", session.id, input),
        intentStart: (session, testResultId, message) =>
          record("intentStart", session.id, testResultId, message),
        intentEnd: (session) => record("intentEnd", session.id),
        stop: (session, status, reason) => record("stop", session.id, status, reason),
        follow: (id) => known("follow", id).pipe(Effect.as(Stream.fromIterable(FOLLOW_EVENTS))),
        stats: record("stats").pipe(Effect.as(STATS)),
        ...overrides,
      });
    }),
  );
  return { calls, layer };
};

export const methods = (fake: FakeSessions): ReadonlyArray<string> =>
  fake.calls.map((call) => call.method);
