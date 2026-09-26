import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer } from "effect";
import * as Client from "@oligarchy/db/client";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Api from "@oligarchy/http/api";
import * as SharedErrors from "@oligarchy/shared/errors";
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
    // A bad url fails while the layer is built, before a query can map it.
    Effect.catchTag("DatabaseError", (error) =>
      Effect.fail(SharedErrors.CommandError.make({ message: error.message })),
    ),
  );

Env.run(
  Env.program(DriverCommand.makeDriverCommand(withStore), {
    version: Api.VERSION,
    layer: NodeHttpClient.layerNodeHttp,
  }),
);
