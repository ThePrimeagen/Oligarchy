import { Effect } from "effect";
import * as Contract from "@oligarchy/routes/contract";
import * as ApiErrors from "@oligarchy/routes/errors";
import type * as ProxyClient from "../client/proxy-client.ts";
import type * as Sessions from "./sessions.ts";

// The guest host, reached through the reverse proxy, as Sessions sees it: a 503 is the fleet
// being full, which the dispatcher places elsewhere; every other failure is this client's to
// report. The cause is the proxy failure itself, so a network error under it is not replaced
// by a fresh error that only keeps the message.
const internal = (agent: string, error: ProxyClient.Failure): ApiErrors.Internal =>
  ApiErrors.Internal.make({ cause: error, agentId: agent });

const refused = (
  agent: string,
  error: ProxyClient.Failure,
): Effect.Effect<never, ApiErrors.AtCapacity | ApiErrors.SetupNeeded | ApiErrors.Internal> => {
  if (error._tag === "ProxyRefusal" && error.status === 503) {
    return ApiErrors.AtCapacity.make({ message: error.message, agentId: agent });
  }
  if (error._tag === "ProxyRefusal" && error.status === 409) {
    return ApiErrors.SetupNeeded.make({ message: error.message, agentId: agent });
  }
  return internal(agent, error);
};

export const reserve =
  (proxy: ProxyClient.ProxyClientService): Sessions.ReserveQemu =>
  (agent, resume, server) =>
    proxy
      .reserve(
        Contract.ReserveAgentBody.make(
          Object.assign(
            { agent },
            resume === undefined ? undefined : { resume },
            server === undefined ? undefined : { server },
          ),
        ),
      )
      .pipe(Effect.catch((error) => refused(agent, error)));

// The guest host already let this reservation go (its own ten minutes ran out first, or it
// restarted) and the proxy has forgotten the route: there is nothing to give back, which is what
// relinquish was for.
const gone = (
  agent: string,
  error: ProxyClient.Failure,
): Effect.Effect<void, ApiErrors.Internal> =>
  error._tag === "ProxyRefusal" && error.status === 400 ? Effect.void : internal(agent, error);

// The sweep that gives expired reservations back is one fiber with nobody waiting on it, and
// node:http has no ceiling of its own: a proxy that never answers must not hold every later
// expiry behind this one.
const RELINQUISH_TIMEOUT = "10 seconds";

export const relinquish =
  (proxy: ProxyClient.ProxyClientService): Sessions.RelinquishQemu =>
  (agent) =>
    proxy.relinquish(Contract.ReserveAgentBody.make({ agent })).pipe(
      Effect.catch((error) => gone(agent, error)),
      Effect.timeoutOrElse({
        duration: RELINQUISH_TIMEOUT,
        orElse: () =>
          ApiErrors.Internal.make({
            cause: new Error(`relinquish: no answer within ${RELINQUISH_TIMEOUT}`),
            agentId: agent,
          }),
      }),
    );
