import { Cause, Console, Effect, Exit, Option, Sink, Stdio, Stream } from "effect";
import * as CliError from "effect/unstable/cli/CliError";
import * as Actions from "../client/actions.ts";
import * as Tools from "../harness/tools.ts";
import * as Render from "../observability/render.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const text = (chunks: ReadonlyArray<Uint8Array>): string =>
  chunks.map((chunk) => decoder.decode(chunk)).join("");

const written = (args: ReadonlyArray<unknown>): Uint8Array =>
  encoder.encode(`${args.map(String).join(" ")}\n`);

const capturingConsole = (
  stdout: Array<Uint8Array>,
  stderr: Array<Uint8Array>,
): Console.Console => {
  const log = (...args: ReadonlyArray<unknown>) => {
    stdout.push(written(args));
  };
  const error = (...args: ReadonlyArray<unknown>) => {
    stderr.push(written(args));
  };
  return Object.assign(Object.create(console), {
    log,
    info: log,
    debug: log,
    error,
    warn: error,
    trace: error,
  });
};

const collect = (into: Array<Uint8Array>) => () =>
  Sink.forEach((value: string | Uint8Array) =>
    Effect.sync(() => {
      into.push(typeof value === "string" ? encoder.encode(value) : value);
    }),
  );

const capturingStdio = (stdout: Array<Uint8Array>, stderr: Array<Uint8Array>) =>
  Stdio.make({
    args: Effect.succeed([]),
    stdin: Stream.empty,
    stdout: collect(stdout),
    stderr: collect(stderr),
    stdoutIsTerminal: Effect.succeed(false),
  });

// The client function for this action, in this process. mouse click is mouseClick.
// Nothing here starts a terminal or a child process.
const runClient = Effect.fn("Driver.runClient")(function* (args: ReadonlyArray<string>) {
  const stdout: Array<Uint8Array> = [];
  const stderr: Array<Uint8Array> = [];
  const exitCode = yield* Effect.gen(function* () {
    const exit = yield* Effect.exit(Actions.call(args));
    if (Exit.isSuccess(exit)) {
      return 0;
    }
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return yield* Effect.interrupt;
    }
    const failure = Cause.findErrorOption(exit.cause);
    if (
      Option.isSome(failure) &&
      CliError.isCliError(failure.value) &&
      failure.value._tag === "UserError"
    ) {
      stderr.push(encoder.encode(`${failure.value.userMessage}\n`));
      return 1;
    }
    yield* Render.reportFailure(exit.cause);
    return 1;
  }).pipe(
    Effect.provideService(Console.Console, capturingConsole(stdout, stderr)),
    Effect.provideService(Stdio.Stdio, capturingStdio(stdout, stderr)),
  );
  return {
    exitCode,
    stdout: text(stdout),
    stderr: text(stderr),
  } satisfies Tools.CommandOutput;
});

export const run = Effect.fn("Driver.client")(function* (command: Tools.CommandLine) {
  return yield* runClient(command.args);
});
