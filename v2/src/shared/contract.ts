import { Effect, Schema } from "effect";
import * as Domain from "./domain.ts";

export class StartBody extends Schema.Class<StartBody>("@oligarchy/shared/contract/StartBody")({
  iso: Schema.NonEmptyString,
  disk: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
}) {}

export class StartResponse extends Schema.Class<StartResponse>(
  "@oligarchy/shared/contract/StartResponse",
)({
  id: Schema.String,
}) {}

// The wire carries the STRING "true", as it always has.
export class Ok extends Schema.Class<Ok>("@oligarchy/shared/contract/Ok")({
  ok: Schema.Literal("true").pipe(Schema.withConstructorDefault(Effect.succeed("true"))),
}) {}

// Query fields for /image and /serial; a plain object so the client passes it as the query.
export const SessionQuery = { id: Schema.String, agent: Schema.NonEmptyString };

// Query fields for /follow and /dump: a follower watches and a dump reads, so neither names an agent.
export const IdQuery = { id: Schema.String };

export class SendKeysBody extends Schema.Class<SendKeysBody>(
  "@oligarchy/shared/contract/SendKeysBody",
)({
  id: Schema.String,
  keys: Schema.String,
  encoding: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
}) {}

// x, y and clicks stay plain numbers: the range checks are handler-level BadRequests with today's messages.
export class SendMouseBody extends Schema.Class<SendMouseBody>(
  "@oligarchy/shared/contract/SendMouseBody",
)({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optionalKey(Domain.MouseButton),
  clicks: Schema.optionalKey(Schema.Number),
  agent: Schema.NonEmptyString,
}) {}

export class StopBody extends Schema.Class<StopBody>("@oligarchy/shared/contract/StopBody")({
  id: Schema.String,
  agent: Schema.NonEmptyString,
  status: Schema.optionalKey(Domain.StopStatus),
  reason: Schema.optionalKey(Schema.String),
}) {}

export class IntentStartBody extends Schema.Class<IntentStartBody>(
  "@oligarchy/shared/contract/IntentStartBody",
)({
  id: Schema.String,
  agent: Schema.NonEmptyString,
  test_result_id: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
}) {}

export class IntentEndBody extends Schema.Class<IntentEndBody>(
  "@oligarchy/shared/contract/IntentEndBody",
)({
  id: Schema.String,
  agent: Schema.NonEmptyString,
}) {}

export class Memory extends Schema.Class<Memory>("@oligarchy/shared/contract/Memory")({
  totalBytes: Schema.Int,
  usedBytes: Schema.Int,
  freeBytes: Schema.Int,
}) {}

export class Cpu extends Schema.Class<Cpu>("@oligarchy/shared/contract/Cpu")({
  cores: Schema.Int,
  mean: Schema.Number,
  p10: Schema.Number,
  p25: Schema.Number,
  p75: Schema.Number,
  p90: Schema.Number,
}) {}

export class Stats extends Schema.Class<Stats>("@oligarchy/shared/contract/Stats")({
  qemus: Schema.Int,
  memory: Memory,
  cpu: Cpu,
}) {}

const STORED_IMAGE_ORIGIN = "https://oligarchy.trm.sh";

export const StoredImageUrl = (id: string): string => `${STORED_IMAGE_ORIGIN}/images/${id}`;
