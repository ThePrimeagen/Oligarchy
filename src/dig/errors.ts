import { Effect, Schema } from "effect";

const fixedMessage = <const M extends string>(message: M) =>
  Schema.Literal(message).pipe(Schema.withConstructorDefault(Effect.succeed(message)));

export class RoomFull extends Schema.TaggedError<RoomFull>("@oligarchy/dig/errors/RoomFull")(
  "RoomFull",
  { message: fixedMessage("the room is full") },
) {}

export class UnknownPlayer extends Schema.TaggedError<UnknownPlayer>(
  "@oligarchy/dig/errors/UnknownPlayer",
)("UnknownPlayer", { message: Schema.String }) {}

export class NotCaptain extends Schema.TaggedError<NotCaptain>("@oligarchy/dig/errors/NotCaptain")(
  "NotCaptain",
  { message: fixedMessage("only the captain can start the game") },
) {}

export class NotReady extends Schema.TaggedError<NotReady>("@oligarchy/dig/errors/NotReady")(
  "NotReady",
  { message: fixedMessage("not every player is ready") },
) {}

export class AlreadyStarted extends Schema.TaggedError<AlreadyStarted>(
  "@oligarchy/dig/errors/AlreadyStarted",
)("AlreadyStarted", { message: fixedMessage("the game already started") }) {}

export class NotPlaying extends Schema.TaggedError<NotPlaying>("@oligarchy/dig/errors/NotPlaying")(
  "NotPlaying",
  { message: fixedMessage("the game has not started") },
) {}

export class UnknownNote extends Schema.TaggedError<UnknownNote>(
  "@oligarchy/dig/errors/UnknownNote",
)("UnknownNote", { message: Schema.String }) {}

export class AlreadyJudged extends Schema.TaggedError<AlreadyJudged>(
  "@oligarchy/dig/errors/AlreadyJudged",
)("AlreadyJudged", { message: fixedMessage("that note was already judged") }) {}
