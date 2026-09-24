import {
  Cause,
  Console,
  Duration,
  Effect,
  Exit,
  Option,
  Result,
  Runtime,
  Sink,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import * as CliConfig from "effect/unstable/cli/CliConfig";
import * as CliError from "effect/unstable/cli/CliError";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as Command from "effect/unstable/cli/Command";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";
import * as ClientCommand from "../client/command.ts";
import * as Config from "../config.ts";
import * as Intent from "../harness/intent.ts";
import * as Tools from "../harness/tools.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";

// client-with-image waits this long so the guest can paint before the screenshot.
const SCREEN = Duration.millis(100);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const append = (first: string, second: string): string => {
  if (first === "") {
    return second;
  }
  if (second === "") {
    return first;
  }
  if (first.endsWith("\n")) {
    return `${first}${second}`;
  }
  return `${first}\n${second}`;
};

const text = (chunks: ReadonlyArray<Uint8Array>): string =>
  chunks.map((chunk) => decoder.decode(chunk)).join("");

const written = (args: ReadonlyArray<unknown>): Uint8Array =>
  encoder.encode(`${args.map(String).join(" ")}\n`);

// A captured command is not a terminal, so help is uncolored and the wizard flag is off,
// the same as ./client.
const formatter = CliOutput.defaultFormatter({ colors: false });

const cliConfig = CliConfig.make({
  builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard),
});

const terminal = Terminal.make({
  columns: Effect.succeed(80),
  rows: Effect.succeed(24),
  readInput: Effect.die("unexpected Terminal.readInput"),
  readLine: Effect.die("unexpected Terminal.readLine"),
  display: () => Effect.die("unexpected Terminal.display"),
});

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

// The same handlers ./client runs, in this process. A failure is the command's exit, the way a
// child that printed its error and exited 1 was: the loop keeps going and the model reads it.
const runClient = Effect.fn("Driver.runClient")(function* (args: ReadonlyArray<string>) {
  const stdout: Array<Uint8Array> = [];
  const stderr: Array<Uint8Array> = [];
  const exitCode = yield* Effect.gen(function* () {
    const exit = yield* Effect.exit(
      Command.runWith(ClientCommand.makeClientCommand(), { version: Api.VERSION })(args),
    );
    if (Exit.isSuccess(exit)) {
      return 0;
    }
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return yield* Effect.interrupt;
    }
    const failure = Cause.findErrorOption(exit.cause);
    if (Option.isNone(failure) || !CliError.isCliError(failure.value)) {
      yield* Render.reportFailure(exit.cause);
    }
    return Option.match(failure, {
      onNone: () => 1,
      onSome: (error) => Runtime.getErrorExitCode(error),
    });
  }).pipe(
    Effect.provideService(Console.Console, capturingConsole(stdout, stderr)),
    Effect.provideService(Stdio.Stdio, capturingStdio(stdout, stderr)),
    Effect.provideService(CliOutput.Formatter, formatter),
    Effect.provideService(CliConfig.CliConfig, cliConfig),
    Effect.provideService(Terminal.Terminal, terminal),
  );
  return {
    exitCode,
    stdout: text(stdout),
    stderr: text(stderr),
  } satisfies Tools.CommandOutput;
});

// client.md: the action, then a screenshot to CLIENT_IMAGE. stop, save and relinquish leave
// nothing on screen. A failed action does not take one either.
const runWithImage = Effect.fn("Driver.runWithImage")(function* (args: ReadonlyArray<string>) {
  const image = yield* Effect.result(Config.required("CLIENT_IMAGE"));
  if (Result.isFailure(image)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "CLIENT_IMAGE is not set\n",
    } satisfies Tools.CommandOutput;
  }
  const ran = yield* runClient(args);
  if (ran.exitCode !== 0) {
    return ran;
  }
  const action = args[0];
  if (action === "stop" || action === "save" || action === "relinquish") {
    return ran;
  }
  const session = Intent.flag(args, "session-id") ?? (ran.stdout.split("\n")[0] ?? "").trim();
  if (session === "") {
    return ran;
  }
  yield* Effect.sleep(SCREEN);
  const agent = Intent.flag(args, "agent-id");
  const server = Intent.flag(args, "server-url");
  const shot = yield* runClient([
    "get-image",
    ...(agent === undefined ? [] : ["--agent-id", agent]),
    "--session-id",
    session,
    "-o",
    image.success,
    ...(server === undefined ? [] : ["--server-url", server]),
  ]);
  if (shot.exitCode === 0) {
    return ran;
  }
  return {
    exitCode: shot.exitCode,
    stdout: append(ran.stdout, shot.stdout),
    stderr: append(ran.stderr, shot.stderr),
  } satisfies Tools.CommandOutput;
});

export const run = Effect.fn("Driver.client")(function* (command: Tools.CommandLine) {
  if (command.bin === "./client-with-image") {
    return yield* runWithImage(command.args);
  }
  return yield* runClient(command.args);
});
