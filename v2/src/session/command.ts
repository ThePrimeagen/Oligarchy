import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Repl from "./repl.ts";

const flags = {
  serverUrl: Flag.string("server-url").pipe(
    Flag.withFallbackConfig(Config.serverUrl),
    Flag.withDefault(Config.DEFAULT_SERVER_URL),
    Flag.withDescription("Proxy URL, used as given; SERVER_URL when omitted"),
  ),
};

export const command = Command.make("session", flags, ({ serverUrl }) =>
  Effect.gen(function* () {
    // The client children read it from the environment; fail here, before the first prompt.
    yield* Config.oligarchyToken;
    yield* Repl.run(serverUrl);
  }),
).pipe(Command.withDescription("Drive one QEMU session interactively"));
