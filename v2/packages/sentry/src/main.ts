import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Http from "@oligarchy/http";
import * as Count from "./count.ts";
import * as Sdk from "./sdk.ts";
import * as Tree from "./tree.ts";
import type * as Types from "./types.ts";

export type {
  Attributes,
  JobReport,
  Level,
  Report,
  Reporter,
  Sentry,
  Span,
  SpanStatus,
  TraceOptions,
} from "./types.ts";

declare module "@oligarchy/app" {
  interface Services {
    sentry: App.Register<"sentry", Types.Sentry>;
  }
}

// How often wait looks at the count again while the SDK is still sending.
const POLL_MS = 250;

export type Options = { readonly dsn: string | undefined; readonly environment: string };

// The process's one Sentry: create initialises the SDK, so a second create replaces the first.
// Every request goes through http, whose timeout is what bounds wait. With no DSN nothing is sent
// and every call settles at once.
export const create = App.createService<Http.Http, Options, Types.Sentry>(({ http }, options) => {
  const count = Count.create();
  const sdk =
    options.dsn === undefined
      ? Sdk.disabled
      : Sdk.create({ dsn: options.dsn, environment: options.environment, http, count });

  return {
    service: "sentry",
    ...Tree.reporter(sdk),
    wait: async () => {
      while (count.open() > 0) {
        await sdk.drain();
        if (count.open() > 0) {
          const stop = new AbortController();
          await Promise.race([count.idle(), Async.sleep(POLL_MS, stop.signal)]);
          stop.abort();
        }
      }
    },
  };
});
