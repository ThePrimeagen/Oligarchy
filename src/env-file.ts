import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";

// The same spelling `Config.providerLayer` scans out of the process arguments. The provider
// reads the file before the CLI parses, because flags that fall back to config (SERVER_URL,
// and the rest) have to see it. This flag is what keeps the parser from refusing the option.
export const envFile = GlobalFlag.setting("env-file")({
  flag: Flag.string("env-file").pipe(
    Flag.optional,
    Flag.withDescription(
      "Also read this env file. The process environment wins, then this file, then .env",
    ),
  ),
});

export const withEnvFile = <Name extends string, Input, E, R, ContextInput>(
  self: Command.Command<Name, Input, ContextInput, E, R>,
) => Command.withGlobalFlags(self, [envFile]);
