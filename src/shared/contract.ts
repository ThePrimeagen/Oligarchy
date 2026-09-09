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

// POST and DELETE /servers on the reverse proxy: the one server the operator names.
export class ServerBody extends Schema.Class<ServerBody>("@oligarchy/shared/contract/ServerBody")({
  url: Domain.ServerUrl,
}) {}

// One registered server as GET /servers reports it; stats is null when its probe failed.
export class Server extends Schema.Class<Server>("@oligarchy/shared/contract/Server")({
  url: Schema.String,
  stats: Schema.NullOr(Stats),
}) {}

export class Servers extends Schema.Class<Servers>("@oligarchy/shared/contract/Servers")({
  servers: Schema.Array(Server),
}) {}

// POST /agent on the reverse proxy: what the agent works on (the Linear ticket a driving agent
// completes, the session a diagnosing agent reviews), which kind it is, and the model. No model
// means the default; reasoning and fast are kept as given.
export class AgentBody extends Schema.Class<AgentBody>("@oligarchy/shared/contract/AgentBody")({
  task: Schema.NonEmptyString,
  type: Domain.AgentType,
  model: Schema.optionalKey(Schema.NonEmptyString),
  reasoning: Schema.optionalKey(Domain.Reasoning),
  fast: Schema.optionalKey(Schema.Boolean),
}) {}

// The agent that started: its id, where to watch it, and the model label it was told it runs as.
export class AgentStarted extends Schema.Class<AgentStarted>(
  "@oligarchy/shared/contract/AgentStarted",
)({
  id: Schema.String,
  url: Schema.String,
  model: Schema.String,
}) {}

const STORED_IMAGE_ORIGIN = "https://oligarchy.trm.sh";

export const StoredImageUrl = (id: string): string => `${STORED_IMAGE_ORIGIN}/images/${id}`;
