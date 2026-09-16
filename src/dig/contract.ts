import { Effect, Schema } from "effect";
import * as Domain from "./domain.ts";

export const ClientMessage = Schema.TaggedUnion({
  Ready: {},
  Start: {},
  Hit: {
    noteId: Schema.Int,
    direction: Domain.Direction,
    songTimeMs: Schema.Number,
  },
  Tick: {
    songTimeMs: Schema.Number,
  },
}).annotate({ identifier: "@oligarchy/dig/contract/ClientMessage" });
export type ClientMessage = typeof ClientMessage.Type;

export const Judged = Schema.Struct({
  noteId: Schema.Int,
  judgment: Domain.Judgment,
}).annotate({ identifier: "@oligarchy/dig/contract/Judged" });

export const Seat = Schema.Struct({
  id: Schema.String,
  slot: Schema.Int,
  ready: Schema.Boolean,
  captain: Schema.Boolean,
  depth: Schema.Number,
  totalDamage: Schema.Number,
  ghost: Schema.Boolean,
  judged: Schema.Array(Judged),
}).annotate({ identifier: "@oligarchy/dig/contract/Seat" });

export const Note = Schema.Struct({
  id: Schema.Int,
  direction: Domain.Direction,
  hitMs: Schema.Number,
}).annotate({ identifier: "@oligarchy/dig/contract/Note" });

export class Snapshot extends Schema.TaggedClass<Snapshot>("@oligarchy/dig/contract/Snapshot")(
  "Snapshot",
  {
    you: Schema.String,
    youAreCaptain: Schema.Boolean,
    captainId: Schema.String,
    phase: Domain.Phase,
    startedAtMs: Schema.Number,
    serverNowMs: Schema.Number,
    readyLabel: Schema.String,
    ghostOpacity: Schema.Number,
    notes: Schema.Array(Note),
    players: Schema.Array(Seat),
  },
) {}

export class Kicked extends Schema.TaggedClass<Kicked>("@oligarchy/dig/contract/Kicked")("Kicked", {
  message: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed("the room is full"))),
}) {}

export class JudgmentFx extends Schema.TaggedClass<JudgmentFx>(
  "@oligarchy/dig/contract/JudgmentFx",
)("JudgmentFx", {
  playerId: Schema.String,
  noteId: Schema.Int,
  judgment: Domain.Judgment,
  damage: Schema.Number,
  depth: Schema.Number,
}) {}

export const ServerMessage = Schema.Union([Snapshot, Kicked, JudgmentFx]).annotate({
  identifier: "@oligarchy/dig/contract/ServerMessage",
});
export type ServerMessage = typeof ServerMessage.Type;

const encodeServer = Schema.encodeSync(ServerMessage);
const decodeClient = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.toCodecJson(ClientMessage)),
);

export const encodeServerLine = (message: ServerMessage): string =>
  JSON.stringify(encodeServer(message));

export const decodeClientLine = (line: string): Effect.Effect<ClientMessage, Schema.SchemaError> =>
  decodeClient(line);
