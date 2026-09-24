import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Option,
  Pull,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Sse from "effect/unstable/encoding/Sse";
import * as History from "./history.ts";
import type * as Tools from "./tools.ts";
import * as Errors from "../shared/errors.ts";

// One streaming chat completion. The header timeout is the wait for a status line, the chunk
// timeout the wait for the next body chunk: OpenRouter's own stream has neither, which is what
// the three-minute OpenCode options were papering over. A 429 or 5xx is retried for the
// Retry-After the response names, and not at all when that wait would run past the run ceiling.
// A 4xx other than 429 refused the request. Anything that never produced a completion left the
// service unreachable.

export type Failure = Errors.OpenRouterRefusal | Errors.OpenRouterUnreachable;

export type Options = {
  readonly baseUrl: string;
  readonly token: Redacted.Redacted;
  readonly model: string;
  readonly messages: ReadonlyArray<History.WireMessage>;
  readonly tools: ReadonlyArray<Tools.ToolDefinition>;
  readonly timeouts: {
    readonly header: Duration.Duration;
    readonly chunk: Duration.Duration;
  };
  readonly runCeiling: Duration.Duration;
  // The run's start on the same clock, so a retry can be refused before the ceiling.
  readonly startedAtMillis: number;
};

// A 429 or 5xx with no Retry-After still waits, so a provider blip is not a tight loop.
const DEFAULT_RETRY = Duration.seconds(1);

// Internal: the attempt failed with a delay that still fits in the ceiling. The schedule sleeps
// it. It does not leave `complete`.
class RetryWait extends Schema.TaggedError<RetryWait>("@oligarchy/harness/openrouter/RetryWait")(
  "RetryWait",
  { delayMillis: Schema.Number },
) {}

type AttemptFailure = Failure | RetryWait;

const WireError = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
]).annotate({ identifier: "@oligarchy/harness/openrouter/WireError" });

const decodeWireError = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.toCodecJson(WireError)),
);

const ErrorPayload = Schema.Union([
  Schema.String,
  Schema.Struct({ message: Schema.String }),
]).annotate({ identifier: "@oligarchy/harness/openrouter/ErrorPayload" });

const decodeErrorPayload = Schema.decodeUnknownEffect(ErrorPayload);

const ToolCallDelta = Schema.Struct({
  index: Schema.Int,
  id: Schema.optionalKey(Schema.String),
  function: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      arguments: Schema.optionalKey(Schema.String),
    }),
  ),
}).annotate({ identifier: "@oligarchy/harness/openrouter/ToolCallDelta" });

const Choice = Schema.Struct({
  finish_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error: Schema.optionalKey(Schema.Unknown),
  delta: Schema.optionalKey(
    Schema.Struct({
      content: Schema.optionalKey(Schema.NullOr(Schema.String)),
      tool_calls: Schema.optionalKey(Schema.Array(ToolCallDelta)),
    }),
  ),
}).annotate({ identifier: "@oligarchy/harness/openrouter/Choice" });

// Errors travel beside `choices`. The envelope is read first so a failure text is not dropped
// because the completion schema rejected the chunk.
const Envelope = Schema.Struct({
  error: Schema.optionalKey(Schema.Unknown),
  choices: Schema.optionalKey(Schema.Unknown),
}).annotate({ identifier: "@oligarchy/harness/openrouter/Envelope" });

const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.toCodecJson(Envelope)),
);

const decodeChoices = Schema.decodeUnknownEffect(Schema.Array(Choice));

const chatCompletionsUrl = (baseUrl: string): string => {
  const withSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("chat/completions", withSlash).toString();
};

const payloadMessage = (payload: typeof ErrorPayload.Type): string =>
  typeof payload === "string" ? payload : payload.message;

const refusalMessage = (text: string): string => {
  if (text === "") {
    return "request failed";
  }
  const decoded = decodeWireError(text);
  if (Option.isNone(decoded)) {
    return text;
  }
  return payloadMessage(decoded.value.error);
};

const unreachable = (message: string, cause: unknown): Errors.OpenRouterUnreachable =>
  Errors.OpenRouterUnreachable.make({ message, cause });

const invalid = (cause: unknown): Errors.OpenRouterUnreachable =>
  unreachable("openrouter: invalid response", cause);

const fromTransport = (error: HttpClientError.HttpClientError): Errors.OpenRouterUnreachable => {
  const cause = "cause" in error.reason ? (error.reason.cause ?? null) : null;
  return unreachable(`${error.request.method} ${error.request.url} failed`, cause);
};

// Delta-seconds, or an HTTP-date. Zero and a date already past wait one millisecond, so a
// stuck 429 still yields. A header that is neither falls back to the one-second wait.
const retryDelay = (header: string | undefined, nowMillis: number): Duration.Duration => {
  if (header === undefined) {
    return DEFAULT_RETRY;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Duration.max(Duration.seconds(Number(trimmed)), Duration.millis(1));
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return DEFAULT_RETRY;
  }
  const millis = parsed - nowMillis;
  if (millis <= 0) {
    return Duration.millis(1);
  }
  return Duration.millis(millis);
};

const retrySchedule: Schedule.Schedule<number, AttemptFailure> = Schedule.forever.pipe(
  Schedule.modifyDelay(({ input }) =>
    Effect.succeed(
      Schema.is(RetryWait)(input) ? Duration.millis(input.delayMillis) : Duration.zero,
    ),
  ),
);

type PartialCall = {
  id: string | undefined;
  name: string | undefined;
  arguments: string;
};

const headerTimeout = unreachable("openrouter: no response within header timeout", null);
const chunkTimeout = unreachable("openrouter: no chunk within chunk timeout", null);

export const complete = Effect.fn("OpenRouter.complete")(function* (options: Options) {
  const client = yield* HttpClient.HttpClient;
  const url = chatCompletionsUrl(options.baseUrl);

  const readEvents = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      const calls: Array<PartialCall | undefined> = [];
      let content: string | null = null;
      let sawTerminal = false;

      const absorb = (delta: typeof ToolCallDelta.Type): void => {
        const existing = calls[delta.index];
        const call = existing ?? { id: undefined, name: undefined, arguments: "" };
        if (delta.id !== undefined && delta.id !== "") {
          call.id = delta.id;
        }
        const name = delta.function?.name;
        if (name !== undefined && name !== "") {
          call.name = name;
        }
        const args = delta.function?.arguments;
        if (args !== undefined) {
          call.arguments = `${call.arguments}${args}`;
        }
        calls[delta.index] = call;
      };

      const failPayload = (payload: typeof ErrorPayload.Type) =>
        unreachable(`openrouter: ${payloadMessage(payload)}`, null);

      const apply = (chunkText: string) =>
        Effect.gen(function* () {
          const envelope = yield* decodeEnvelope(chunkText).pipe(Effect.mapError(invalid));
          if (envelope.error !== undefined) {
            const payload = yield* decodeErrorPayload(envelope.error).pipe(
              Effect.mapError(invalid),
            );
            return yield* failPayload(payload);
          }
          if (envelope.choices === undefined) {
            return yield* Effect.void;
          }
          const choices = yield* decodeChoices(envelope.choices).pipe(Effect.mapError(invalid));
          const choice = choices[0];
          if (choice === undefined) {
            return yield* Effect.void;
          }
          if (choice.error !== undefined) {
            const payload = yield* decodeErrorPayload(choice.error).pipe(Effect.mapError(invalid));
            return yield* failPayload(payload);
          }
          if (typeof choice.finish_reason === "string") {
            sawTerminal = true;
          }
          const delta = choice.delta;
          if (delta === undefined) {
            return yield* Effect.void;
          }
          if (typeof delta.content === "string") {
            content = content === null ? delta.content : `${content}${delta.content}`;
          }
          const toolCalls = delta.tool_calls;
          if (toolCalls === undefined) {
            return yield* Effect.void;
          }
          for (const call of toolCalls) {
            absorb(call);
          }
          return yield* Effect.void;
        });

      // Stream.timeout does not see the test clock: it samples Clock from the stream's
      // parent and sleeps against a different one. Each pull is timed with Effect.timeout,
      // the same primitive as the header timeout, so a gap between chunks fails on either clock.
      // A chat completion does not use the SSE retry field; a directive is a broken stream.
      const decoder = new TextDecoder();
      const queued: Array<Sse.Event | Sse.Retry> = [];
      const parser = Sse.makeParser((event) => {
        queued.push(event);
      });

      const onEvent = (event: Sse.Event | Sse.Retry) => {
        if (event._tag === "Retry") {
          return unreachable("openrouter: invalid response", event);
        }
        if (event.data === "[DONE]") {
          sawTerminal = true;
          return Effect.void;
        }
        return apply(event.data);
      };

      const feed = (text: string) =>
        Effect.gen(function* () {
          const error = parser.feed(text);
          if (error !== undefined) {
            return yield* invalid(error);
          }
          for (const event of queued) {
            yield* onEvent(event);
          }
          queued.length = 0;
          return yield* Effect.void;
        });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(response.stream);
          const read: Effect.Effect<void, Failure> = Effect.gen(function* () {
            const step = yield* pull.pipe(
              Effect.timeoutOrElse({
                duration: options.timeouts.chunk,
                orElse: () => Effect.fail(chunkTimeout),
              }),
              Effect.exit,
            );
            if (Exit.isFailure(step)) {
              if (Pull.isDoneCause(step.cause)) {
                return yield* Effect.void;
              }
              const failed = Cause.findErrorOption(step.cause);
              if (Option.isSome(failed) && failed.value._tag === "OpenRouterUnreachable") {
                return yield* failed.value;
              }
              return yield* invalid(Cause.squash(step.cause));
            }
            for (const bytes of step.value) {
              yield* feed(decoder.decode(bytes, { stream: true }));
            }
            if (sawTerminal) {
              return yield* Effect.void;
            }
            return yield* read;
          });
          yield* read;
          if (!sawTerminal) {
            yield* feed(decoder.decode());
          }
        }),
      );

      if (!sawTerminal) {
        return yield* unreachable("openrouter: stream ended before the completion", null);
      }

      const toolCalls: Array<History.AssistantTurn["toolCalls"][number]> = [];
      for (const call of calls) {
        if (call === undefined) {
          continue;
        }
        if (call.id === undefined) {
          return yield* unreachable("openrouter: a tool call has no id", null);
        }
        if (call.name === undefined) {
          return yield* unreachable("openrouter: a tool call has no name", null);
        }
        toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments });
      }
      return { content, toolCalls };
    });

  const retryOrGiveUp = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      const now = yield* Clock.currentTimeMillis;
      const header = Option.getOrUndefined(Headers.get(response.headers, "retry-after"));
      const delay = retryDelay(header, now);
      const remaining = Duration.subtract(
        options.runCeiling,
        Duration.millis(now - options.startedAtMillis),
      );
      if (Duration.Order(delay, remaining) >= 0) {
        return yield* unreachable(
          `openrouter: retry-after of ${Duration.format(delay)} would pass the run ceiling: ${refusalMessage(text)}`,
          null,
        );
      }
      return yield* RetryWait.make({ delayMillis: Duration.toMillis(delay) });
    });

  const refuse = (response: HttpClientResponse.HttpClientResponse) =>
    response.text.pipe(
      Effect.orElseSucceed(() => ""),
      Effect.flatMap((text) =>
        Effect.fail(
          Errors.OpenRouterRefusal.make({
            status: response.status,
            message: refusalMessage(text),
          }),
        ),
      ),
    );

  const attempt: Effect.Effect<History.AssistantTurn, AttemptFailure> = Effect.gen(function* () {
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.bearerToken(options.token),
      HttpClientRequest.bodyJsonUnsafe({
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        stream: true,
      }),
    );
    const response = yield* client.execute(request).pipe(
      Effect.timeoutOrElse({
        duration: options.timeouts.header,
        orElse: () => Effect.fail(headerTimeout),
      }),
      Effect.mapError((error) =>
        error._tag === "OpenRouterUnreachable" ? error : fromTransport(error),
      ),
    );
    if (response.status === 429 || response.status >= 500) {
      return yield* retryOrGiveUp(response);
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* refuse(response);
    }
    return yield* readEvents(response);
  });

  return yield* attempt.pipe(
    Effect.retry({
      while: (error) => error._tag === "RetryWait",
      schedule: retrySchedule,
    }),
    Effect.mapError((error) =>
      error._tag === "RetryWait"
        ? unreachable("openrouter: retry-after would pass the run ceiling", null)
        : error,
    ),
  );
});
