import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Effect, Layer, type Runtime } from "effect";
import * as CliConfig from "effect/unstable/cli/CliConfig";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as Command from "effect/unstable/cli/Command";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as Colors from "./colors.ts";
import * as Config from "./config.ts";

// What every entry installs before its command runs: the variable lookup, the CLI's output and
// its config without the Wizard, and whether log lines take colour. CLI help colour stays the
// CLI's own tty probe; wantsColor, which honours FORCE_COLOR, decides Log.Colors alone.
const EnvLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  Layer.succeed(Log.Colors)(Colors.stdoutColors),
  Config.live,
);

export type Options<ROut, LE, RIn> = {
  readonly version: string;
  // The process's own graph, built over the environment before the command runs.
  readonly layer: Layer.Layer<ROut, LE, RIn>;
  // A server logs every failure as a fatal line before it fails, so only a defect, which nothing
  // logged, is printed; a CLI has no log and prints every failure.
  readonly failuresLogged?: true;
};

// The effect an entry runs. The graph is built first, so a missing variable or a bad
// DATABASE_URL, the one failure no Log exists to record, is printed here; then the command runs
// under it, and what it fails with is printed once, outside every layer, unless the process
// logged it already. A CliError has been rendered by the CLI and says nothing more.
export const program = <Name extends string, Input, ContextInput, E, R, ROut, LE, RIn>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  options: Options<ROut, LE, RIn>,
) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(Layer.provideMerge(options.layer, EnvLive)).pipe(
      Effect.tapCause(Render.reportFailure),
    );
    const run = Command.run(command, { version: options.version }).pipe(Effect.provide(services));
    yield* options.failuresLogged === true
      ? run.pipe(Effect.tapDefect((defect) => Render.reportFailure(Cause.die(defect))))
      : run.pipe(Effect.tapCause(Render.reportFailure));
  }).pipe(Effect.scoped);

// The one NodeRuntime.runMain: SIGINT and SIGTERM interrupt the root fiber and scopes close in
// reverse order; error reporting is off because `program` printed already. stdout is the
// convenience copy of the log; a write refused by a full filesystem (ENOSPC) drops that line
// instead of raising an uncaught exception per line, which took a qemu server down once.
export const run = <E>(
  main: Effect.Effect<void, E, Layer.Success<typeof NodeServices.layer>>,
  options: { readonly teardown?: Runtime.Teardown } = {},
): void => {
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
  NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)), {
    disableErrorReporting: true,
    ...options,
  });
};
