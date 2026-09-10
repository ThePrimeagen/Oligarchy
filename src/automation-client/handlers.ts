import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as OpenCode from "./opencode.ts";

const ok = Contract.Ok.make({});

// A client that disconnects mid-run must not kill OpenCode: the work is the process, not the
// HTTP conversation that launched it.
const uninterruptible = { uninterruptible: true } as const;

export const RunsLive = HttpApiBuilder.group(Api.AutomationClientApi, "Runs", (handlers) =>
  handlers.handle(
    "run",
    ({ payload }) =>
      Effect.gen(function* () {
        yield* OpenCode.run(payload.prompt, payload.model);
        return ok;
      }),
    uninterruptible,
  ),
);

export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.AutomationClientApi).pipe(
    Layer.provide(RunsLive),
    Layer.provide(Layer.mergeAll(Middleware.BearerAuthLive, Middleware.ApiBoundaryLive)),
  ),
  QemuServerHandlers.NotFoundRoute,
);
