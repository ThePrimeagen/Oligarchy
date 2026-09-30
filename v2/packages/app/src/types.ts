import type * as jarl from "jarl";
import type { Services } from "./services.ts";

// Every type that makes the app check itself lives here; app.ts only names them.

// Any registered service: a fixed `service` name and its operations.
export type AnyService = Services[keyof Services];

// Services filed under their own names: Needs<Logger | Database> is { logger: Logger; db: Database }.
export type Needs<T extends AnyService> = { readonly [S in T as S["service"]]: S };

declare const made: unique symbol;

// A service as createService built it. Nothing else makes one, so a service built by hand, a
// fake included, is refused wherever services are handed over.
export type Made<S extends AnyService> = S & { readonly [made]: S["service"] };

// What a create is handed: each service it wants, under its name, as createService built it. One
// that wants nothing is handed no service at all.
export type Given<Deps extends AnyService> = [Deps] extends [never]
  ? Readonly<Record<string, never>>
  : { readonly [S in Deps as S["service"]]: Made<S> };

// A create's options after its services: void options are left out, and all-optional ones may be.
export type OptionsArgs<Options> = [Options] extends [void]
  ? []
  : {} extends Options
    ? [options?: Options]
    : [options: Options];

// An entry in Services, whose key must be the service's own name.
export type Register<Name extends string, T extends { readonly service: Name }> = T;

// What a top app runs on: each key a service's name, its value that service as createService built it.
export type Provided = { readonly [K in keyof Services]?: Made<Services[K]> };

// A bare service where the object of services goes has a `service` field; this refuses it.
export type NotAService = { readonly service?: never };

// Every key of a services object must be a service's name, even beside one that is.
export type OnlyServices<S> = { readonly [K in Exclude<keyof S, keyof Services>]: never };

// The keys a services object certainly has: an optional key, or one that may be undefined, is not
// a service main can be handed.
export type NamesOf<S> = {
  [K in keyof S]-?: {} extends Pick<S, K> ? never : undefined extends S[K] ? never : K;
}[keyof S];

type Missing<Wants extends AnyService, Names> = Exclude<Wants["service"], Names>;

// Nothing to add when every service wanted is there; otherwise the error names the rest.
export type Provides<Wants extends AnyService, Names> = [Missing<Wants, Names>] extends [never]
  ? unknown
  : { readonly missing: Missing<Wants, Names> };

export type Signal = "SIGINT" | "SIGTERM" | "SIGHUP";

// A sub-app never sees a signal: its parent stopping, for whatever reason, is what stops it.
export type ExitReason =
  | { readonly kind: "returned" }
  | { readonly kind: "signal"; readonly signal: Signal }
  | { readonly kind: "parent" };

// What main and the exit handlers hand back: an error they return is one the top app closes with.
export type Outcome = jarl.Result<void, unknown>;

export type OnExit = (reason: ExitReason) => void | Outcome | Promise<void | Outcome>;

// The top app's last word: every error its tree returned or threw, in the order they happened.
export type OnClose = (errors: ReadonlyArray<unknown>) => void | Outcome | Promise<void | Outcome>;

// The process as the app sees it; a test passes its own.
export type Io = {
  readonly onSignal: (handler: (signal: Signal) => void) => () => void;
  readonly exit: (code: number) => void;
  readonly stderr: (text: string) => void;
};

// Any app with at least these services: what a helper takes.
export interface Has<T extends AnyService> {
  readonly services: Needs<T>;
  readonly signal: AbortSignal;
  onExit(handler: OnExit): () => void;
}
