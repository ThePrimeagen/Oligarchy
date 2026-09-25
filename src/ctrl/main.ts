import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Layer } from "effect";
import * as Env from "@oligarchy/env/run";
import * as Api from "@oligarchy/routes/api";
import * as Sentry from "../observability/sentry.ts";
import * as CtrlCommand from "./command.ts";

// Sentry sits beneath everything a command builds: the Log a database action builds captures the
// reporter, and its rows flush when the action's layer closes, before this scope flushes Sentry.
// Colours too: that Log reads Log.Colors from the context the runner built.
const MainLive = NodeHttpClient.layerNodeHttp.pipe(Layer.provideMerge(Sentry.SentryLive));

Env.run(Env.program(CtrlCommand.makeCtrlCommand(), { version: Api.VERSION, layer: MainLive }));
