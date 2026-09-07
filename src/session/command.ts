import { Effect, FileSystem, Layer, Option, type Redacted, Schema, Stdio, Stream } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Actions from "../db/actions.ts";
import * as Client from "../db/client.ts";
import * as Errors from "../shared/errors.ts";
import * as Repl from "./repl.ts";

// The one store `image` reads, replaceable by a fake in tests.
export type Deps = {
  readonly database: (
    url: Redacted.Redacted,
  ) => Layer.Layer<Actions.ActionStore, Errors.DatabaseError>;
};

export const live: Deps = {
  database: (url) => Actions.ActionStore.layer.pipe(Layer.provide(Client.Database.layer(url))),
};

const flags = {
  serverUrl: Flag.string("server-url").pipe(
    Flag.withFallbackConfig(Config.serverUrl),
    Flag.withDefault(Config.DEFAULT_SERVER_URL),
    Flag.withDescription("Proxy URL, used as given; SERVER_URL when omitted"),
  ),
};

const ImageId = Schema.String.check(
  Schema.isUUID(undefined, {
    message: "image-id must be a uuid, as ctrl session --images prints it",
  }),
);

const imageFlags = {
  imageId: Flag.string("image-id").pipe(
    Flag.withSchema(ImageId),
    Flag.withDescription("Image id, as ctrl session --images prints it"),
  ),
  output: Flag.string("output").pipe(
    Flag.withAlias("o"),
    Flag.optional,
    Flag.withDescription("Write the PNG here instead of stdout"),
  ),
};

export const makeSessionCommand = (deps: Deps = live) => {
  const withDb = Layer.unwrap(Effect.map(Config.databaseUrl, (url) => deps.database(url)));

  // image --image-id <id> [-o <file>]: a stored screenshot straight from the database, which every
  // environment can reach, where the proxy and the dashboard may not be.
  const image = Command.make(
    "image",
    imageFlags,
    Effect.fn("session.image")(function* (input: {
      readonly imageId: string;
      readonly output: Option.Option<string>;
    }) {
      const actions = yield* Actions.ActionStore;
      const bytes = yield* Effect.flatMap(
        actions.getImage(input.imageId),
        Option.match({
          onNone: () =>
            Effect.fail(Errors.CommandError.make({ message: `image: no image ${input.imageId}` })),
          onSome: Effect.succeed,
        }),
      );
      if (Option.isSome(input.output)) {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFile(input.output.value, bytes, { mode: 0o644 });
        return;
      }
      const stdio = yield* Stdio.Stdio;
      yield* Stream.run(Stream.make(bytes), stdio.stdout());
    }),
  ).pipe(
    Command.withDescription("Print a stored screenshot as PNG, read from the database"),
    Command.provide(withDb),
  );

  return Command.make("session", flags, ({ serverUrl }) =>
    Effect.gen(function* () {
      // The client children read it from the environment; fail here, before the first prompt.
      yield* Config.oligarchyToken;
      yield* Repl.run(serverUrl);
    }),
  ).pipe(
    Command.withDescription("Drive one QEMU session interactively; or image --image-id <id>"),
    Command.withSubcommands([image]),
  );
};
