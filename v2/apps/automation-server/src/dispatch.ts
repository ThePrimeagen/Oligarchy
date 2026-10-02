import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";

export type Options = {
  readonly http: Http.Http;
  readonly token: { readonly reveal: () => string };
  readonly tests: Stores.Tests.Tests;
  readonly servers: Stores.Servers.Servers;
  readonly setupRequests: Stores.SetupRequests.SetupRequests;
  readonly logger: Logger.Logger;
  readonly signal?: AbortSignal;
};

export type Dispatch = {
  readonly pass: () => Promise<boolean>;
};

// It dispatches nothing yet.
export const create = (_options: Options): Dispatch => ({
  pass: () => Promise.resolve(false),
});
