import * as Env from "@oligarchy/env";

export const app = Env.cli({ name: "driver", description: "Run the harness loop for one prompt" })
  .flags({
    action: Env.args.action(),
    prompt: Env.args.prompt(),
    agentId: Env.args.agentId(),
    debugLog: Env.args.debugLog(false),
    serverUrl: Env.args.serverUrl(false),
  })
  .needs("openRouterToken", "databaseUrl")
  .done();
