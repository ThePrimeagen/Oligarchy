import {
  Cause,
  Console,
  Deferred,
  Effect,
  Fiber,
  Option,
  type Path,
  Ref,
  Result,
  type Scope,
  Stream,
} from "effect";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Contract from "@oligarchy/routes/contract";
import * as Render from "../observability/render.ts";
import * as Children from "./children.ts";
import * as Grammar from "./grammar.ts";
import * as Image from "./image.ts";
import * as Readline from "./readline.ts";
import * as State from "./state.ts";

type Env = State.Host | ChildProcessSpawner.ChildProcessSpawner | Path.Path;

type Repl = {
  readonly host: State.HostShape;
  readonly session: State.Session;
  readonly terminal: Readline.Terminal;
  // The REPL's own scope: work that must outlive one line (a start).
  readonly scope: Scope.Scope;
  readonly requestExit: Effect.Effect<void>;
};

const NO_SESSION = "no session. run start first.";
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const requireSession = (session: State.Session): Effect.Effect<Option.Option<string>> =>
  Ref.get(session.sessionId).pipe(
    Effect.tap(Option.match({ onNone: () => Console.log(NO_SESSION), onSome: () => Effect.void })),
  );

const okOrStderr = (result: Children.ChildResult): Effect.Effect<void> =>
  Console.log(result.code === 0 ? "ok" : result.stderr);

const start = (repl: Repl, command: Grammar.Start): Effect.Effect<void, never, Env> =>
  Effect.gen(function* () {
    const { session } = repl;
    const running = yield* Ref.get(session.sessionId);
    if (Option.isSome(running)) {
      yield* Console.log(`session ${running.value} is already running. stop it first.`);
      return;
    }
    const agentId = yield* State.freshAgentId;
    yield* Ref.set(session.agentId, agentId);
    yield* Console.log("booting; a first-time iso download can take a while...");
    // A start killed mid-boot still boots on the proxy (/start is uninterruptible), so the boot
    // runs in the REPL's scope and records its id itself: shutdown awaits it and stops that
    // session rather than leaving an unreachable one behind.
    const boot = Children.runClient(session, Grammar.toClientArgs(command, "")).pipe(
      Effect.tap((result) =>
        result.code === 0
          ? Ref.set(session.sessionId, Option.some(decoder.decode(result.stdout).trim()))
          : Effect.void,
      ),
      Effect.ensuring(Ref.set(session.startInFlight, Option.none())),
    );
    const fiber = yield* Effect.forkIn(boot, repl.scope);
    yield* Ref.set(session.startInFlight, Option.some(fiber));
    const result = yield* Fiber.join(fiber);
    if (result.code !== 0) {
      yield* Console.log(result.stderr);
      return;
    }
    yield* Console.log(`agent   ${agentId}`);
    yield* Console.log(`session ${decoder.decode(result.stdout).trim()}`);
  });

const stop = (
  session: State.Session,
  status: Option.Option<Contract.StopStatus>,
  reason: Option.Option<string>,
): Effect.Effect<void, never, Env> =>
  Effect.gen(function* () {
    const id = yield* requireSession(session);
    if (Option.isNone(id)) {
      return;
    }
    const result = yield* Children.runClient(
      session,
      Grammar.toClientArgs({ _tag: "stop", status, reason }, id.value),
    );
    // Clear the session either way: a failed stop means the proxy already lost it
    // (killed on timeout, gone), so keeping the id would only wedge the next start.
    yield* Ref.set(session.sessionId, Option.none());
    yield* Ref.set(session.intentOpen, false);
    yield* Console.log(result.code === 0 ? `stopped ${id.value}` : result.stderr);
  });

const withSession = (
  session: State.Session,
  command: Grammar.ClientCommand,
  onResult: (result: Children.ChildResult) => Effect.Effect<void>,
): Effect.Effect<void, never, Env> =>
  Effect.gen(function* () {
    const id = yield* requireSession(session);
    if (Option.isNone(id)) {
      return;
    }
    yield* onResult(yield* Children.runClient(session, Grammar.toClientArgs(command, id.value)));
  });

const intent = (
  session: State.Session,
  command: Grammar.ClientCommand,
  open: boolean,
): Effect.Effect<void, never, Env> =>
  withSession(session, command, (result) =>
    result.code === 0
      ? Ref.set(session.intentOpen, open).pipe(Effect.andThen(Console.log("ok")))
      : Console.log(result.stderr),
  );

const getImage = (repl: Repl): Effect.Effect<void, never, Env> =>
  withSession(repl.session, { _tag: "get-image" }, (result) => {
    if (result.code !== 0) {
      return Console.log(result.stderr);
    }
    return Result.match(
      Image.renderImage(result.stdout, repl.host.imageProtocol, repl.host.output.columns ?? 80),
      {
        onFailure: (error) => Console.error(error.message),
        onSuccess: (text) => Readline.write(repl.host.output, text),
      },
    );
  });

const getSerial = (session: State.Session): Effect.Effect<void, never, Env> =>
  withSession(session, { _tag: "get-serial" }, (result) => {
    if (result.code !== 0) {
      return Console.log(result.stderr);
    }
    const text = decoder.decode(result.stdout);
    return Console.log(text === "" ? "(serial is empty)" : text);
  });

const status = (repl: Repl): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { session } = repl;
    yield* Console.log(`agent   ${yield* Ref.get(session.agentId)}`);
    yield* Console.log(`server  ${session.serverUrl}`);
    yield* Console.log(
      `session ${Option.getOrElse(yield* Ref.get(session.sessionId), () => "none")}`,
    );
    yield* Console.log(`intent  ${(yield* Ref.get(session.intentOpen)) ? "open" : "none"}`);
  });

// A malformed line is judged the way its command would have been: `start` first asks whether a
// session runs, the driving commands first ask for one, and only then is the usage printed.
const malformed = (
  session: State.Session,
  command: Grammar.MalformedCommand,
  usage: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (command === "start") {
      const running = yield* Ref.get(session.sessionId);
      if (Option.isSome(running)) {
        yield* Console.log(`session ${running.value} is already running. stop it first.`);
        return;
      }
    } else if (Grammar.needsSession(command) && Option.isNone(yield* requireSession(session))) {
      return;
    }
    yield* Console.log(usage);
  });

const dispatch = (repl: Repl, line: string): Effect.Effect<void, never, Env> => {
  const command = Grammar.parseLine(line);
  switch (command._tag) {
    case "start":
      return start(repl, command);
    case "get-image":
      return getImage(repl);
    case "get-serial":
      return getSerial(repl.session);
    case "send-keys":
    case "mouse":
      return withSession(repl.session, command, okOrStderr);
    case "intent-start":
      return intent(repl.session, command, true);
    case "intent-end":
      return intent(repl.session, command, false);
    case "stop":
      return stop(repl.session, command.status, command.reason);
    case "status":
      return status(repl);
    case "help":
      return Console.log(Grammar.HELP);
    case "exit":
      return repl.requestExit;
    case "malformed":
      return malformed(repl.session, command.command, command.usage);
    case "unknown":
      return Console.log(Grammar.unknownCommand(command.command));
  }
  return command satisfies never;
};

// A defect in one command (a spawn that could not happen) is printed like a failed one and the
// REPL goes on; an interruption is the REPL's own and passes through.
const reporting = <A, R>(self: Effect.Effect<A, never, R>): Effect.Effect<void, never, R> =>
  self.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Console.error(Render.renderFailure(cause)),
    ),
  );

// ---------------------------------------------------------------------------
// Completion, signals, shutdown
// ---------------------------------------------------------------------------

const complete = (request: Readline.CompletionRequest): Effect.Effect<void> =>
  Effect.sync(() => {
    request.complete(Grammar.complete(request.line).completion);
  });

const onSigint = (repl: Repl): Effect.Effect<void> => repl.requestExit;

const shutdown = (repl: Repl, completions: Fiber.Fiber<void>): Effect.Effect<void, never, Env> =>
  Effect.gen(function* () {
    const { session } = repl;
    yield* Fiber.interrupt(completions);
    yield* Readline.close(repl.terminal.handle);
    const inflight = yield* Ref.get(session.startInFlight);
    if (Option.isSome(inflight)) {
      yield* Fiber.await(inflight.value);
    }
    const id = yield* Ref.get(session.sessionId);
    if (Option.isSome(id)) {
      yield* Console.log(`stopping session ${id.value}`);
      yield* stop(session, Option.none(), Option.none());
    }
  });

const prompt = (repl: Repl): Effect.Effect<void> =>
  Effect.flatMap(Ref.get(repl.session.sessionId), (id) =>
    Readline.prompt(
      repl.terminal.handle,
      Option.match(id, {
        onNone: () => "session> ",
        onSome: (found) => `session ${found.slice(0, 8)}> `,
      }),
    ),
  );

export const run = Effect.fn("Repl.run")(function* (
  serverUrl: string,
  envFile: Option.Option<string> = Option.none(),
) {
  yield* Effect.scoped(
    Effect.gen(function* () {
      const host = yield* State.Host;
      const scope = yield* Effect.scope;
      const session = yield* State.make(serverUrl, envFile);
      const terminal = yield* Readline.open(host.input, host.output);
      const exitRequested = yield* Deferred.make<void>();
      const repl: Repl = {
        host,
        session,
        terminal,
        scope,
        requestExit: Deferred.succeed(exitRequested, undefined).pipe(Effect.asVoid),
      };
      yield* Console.log(`server ${serverUrl}`);
      yield* Console.log(Grammar.HINT);
      const completions = yield* Effect.forkScoped(
        Stream.runForEach(terminal.completions, (request) => reporting(complete(request))),
      );
      yield* Effect.forkScoped(Stream.runForEach(terminal.sigints, () => onSigint(repl)));
      yield* Effect.forkScoped(host.termination.pipe(Effect.andThen(repl.requestExit)));
      yield* prompt(repl);
      const loop = Stream.runForEach(terminal.lines, (line) =>
        Effect.gen(function* () {
          const trimmed = line.trim();
          if (trimmed !== "") {
            yield* reporting(dispatch(repl, trimmed));
          }
          if (!(yield* Deferred.isDone(exitRequested))) {
            yield* prompt(repl);
          }
        }),
      );
      yield* Effect.raceFirst(loop, Deferred.await(exitRequested));
      yield* shutdown(repl, completions);
    }),
  );
});
