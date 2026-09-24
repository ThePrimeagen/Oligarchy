import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as CliConfig from "effect/unstable/cli/CliConfig";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as Command from "effect/unstable/cli/Command";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";
import * as Config from "../config.ts";
import * as Client from "../db/client.ts";
import * as Tests from "../db/tests.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as DriverCommand from "./command.ts";
import * as Loop from "./loop.ts";

// Built when the loop starts, after flags, the config file, and the token. --help never
// reaches it, so a missing DATABASE_URL is not a usage error.
const withStore = (input: Loop.Input) =>
  Loop.run(input).pipe(
    Effect.provide(
      Layer.unwrap(
        Effect.map(Config.databaseUrl, (url) =>
          Tests.TestStore.layer.pipe(Layer.provide(Client.Database.layer(url))),
        ),
      ),
    ),
  );

const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  NodeHttpClient.layerNodeHttp,
).pipe(Layer.provideMerge(Config.providerLayer), Layer.provideMerge(NodeServices.layer));

const main = Command.run(DriverCommand.makeDriverCommand(withStore), { version: Api.VERSION }).pipe(
  Effect.provide(MainLive),
  Effect.scoped,
  Effect.tapCause(Render.reportFailure),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
