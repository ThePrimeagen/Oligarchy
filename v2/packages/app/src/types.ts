import type { Services } from "./services.ts";

// Every type that makes the app check itself lives here; app.ts only names them.

// Any registered service: a fixed `service` name and its operations.
export type AnyService = Services[keyof Services];

// Services filed under their own names: Needs<Log | Database> is { log: Log; db: Database }.
export type Needs<T extends AnyService> = { readonly [S in T as S["service"]]: S };

// An entry in Services, whose key must be the service's own name.
export type Register<Name extends string, T extends { readonly service: Name }> = T;

// What an app is built from: each key a service's name, its value that service.
export type Provided = { readonly [K in keyof Services]?: Services[K] };

// A bare service where the object of services goes has a `service` field; this refuses it.
export type NotAService = { readonly service?: never };

// An app is written with the services main wants (a union) or built from an object. Both read as
// the same object of services, and both name the same keys.
export type ServicesOf<S> = [S] extends [AnyService] ? Needs<S> : S;
export type NamesOf<S> = [S] extends [AnyService] ? S["service"] : keyof S;

type Missing<Wants extends AnyService, Names> = Exclude<Wants["service"], Names>;

// Nothing to add when the app has every service main wants; otherwise the error names the rest.
export type Provides<Wants extends AnyService, Names> = [Missing<Wants, Names>] extends [never]
  ? unknown
  : { readonly missing: Missing<Wants, Names> };

export type Signal = "SIGINT" | "SIGTERM";

export type ExitReason =
  | { readonly kind: "returned" }
  | { readonly kind: "signal"; readonly signal: Signal };

export type OnExit = (reason: ExitReason) => void | Promise<void>;

// The process as the app sees it; a test passes its own.
export type Io = {
  readonly onSignal: (handler: (signal: Signal) => void) => () => void;
  readonly exit: (code: number) => void;
};

// Any app with at least these services: what a helper takes.
export interface Has<T extends AnyService> {
  readonly services: Needs<T>;
  onExit(handler: OnExit): () => void;
}
