import { Effect } from "effect";
import type * as ProxyClient from "../client/proxy-client.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import type * as Sessions from "./sessions.ts";

// The guest host, reached through the reverse proxy, as Sessions sees it: a 503 is the fleet
// being full, which the dispatcher places elsewhere; every other failure is this client's to
// report.
const internal = (agent: string, error: ProxyClient.Failure): Errors.Internal =>
  Errors.Internal.make({ cause: new Error(error.message), agentId: agent });

const refused = (
  agent: string,
  error: ProxyClient.Failure,
): Effect.Effect<never, Errors.AtCapacity | Errors.Internal> =>
  error._tag === "ProxyRefusal" && error.status === 503
    ? Errors.AtCapacity.make({ message: error.message, agentId: agent })
    : internal(agent, error);

export const reserve =
  (proxy: ProxyClient.ProxyClientService): Sessions.ReserveQemu =>
  (agent) =>
    proxy
      .reserve(Contract.ReserveAgentBody.make({ agent }))
      .pipe(Effect.catch((error) => refused(agent, error)));

// The guest host already let this reservation go (its own ten minutes ran out first, or it
// restarted) and the proxy has forgotten the route: there is nothing to give back, which is what
// relinquish was for.
const gone = (agent: string, error: ProxyClient.Failure): Effect.Effect<void, Errors.Internal> =>
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
          Errors.Internal.make({
            cause: new Error(`relinquish: no answer within ${RELINQUISH_TIMEOUT}`),
            agentId: agent,
          }),
      }),
    );
