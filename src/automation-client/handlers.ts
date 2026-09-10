import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as OpenCode from "./opencode.ts";

const ok = Contract.Ok.make({});

export const BearerAuthLive = Layer.unwrap(Effect.map(Config.oligarchyToken, Middleware.bearerAuth));

export const RunsLive = HttpApiBuilder.group(Api.AutomationClientApi, "Runs", (handlers) =>
  handlers.handle("run", ({ payload }) =>
    Effect.gen(function* () {
      yield* OpenCode.run(payload.prompt);
      return ok;
    }),
  ),
);

export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.AutomationClientApi).pipe(
    Layer.provide(RunsLive),
    Layer.provide(Middleware.ApiBoundaryLive),
  ),
  QemuServerHandlers.NotFoundRoute,
);
