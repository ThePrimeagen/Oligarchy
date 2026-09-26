import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Env from "@oligarchy/env/run";
import * as Api from "@oligarchy/http/api";
import * as ClientCommand from "./command.ts";

Env.run(
  Env.program(ClientCommand.makeClientCommand(), {
    version: Api.VERSION,
    layer: NodeHttpClient.layerNodeHttp,
  }),
);
