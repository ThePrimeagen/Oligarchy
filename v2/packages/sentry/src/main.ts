import type * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
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

export const create = (options: {
  readonly dsn: string | undefined;
  readonly environment: string;
  readonly http: Http.Http;
}): Types.Sentry => {
  void options;
  throw new Error("not implemented");
};
