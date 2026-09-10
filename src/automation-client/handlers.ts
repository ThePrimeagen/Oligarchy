import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Runs from "./runs.ts";

export const RunsLive = HttpApiBuilder.group(Api.AutomationClientApi, "Runs", (handlers) =>
  handlers.handle("run", ({ payload }) =>
    Effect.gen(function* () {
      const runs = yield* Runs.Runs;
      return yield* runs.run(payload);
    }),
  ),
);

export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.AutomationClientApi).pipe(
    Layer.provide(RunsLive),
    Layer.provide(Layer.mergeAll(Middleware.BearerAuthLive, Middleware.ApiBoundaryLive)),
  ),
  QemuServerHandlers.NotFoundRoute,
);
