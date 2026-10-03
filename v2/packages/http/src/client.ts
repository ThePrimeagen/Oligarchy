// A client of one app, typed by the routes it exports. Made once from that app's url and token,
// it posts to a route by its path, and Hono's types say which paths there are and the body and
// statuses of each; only the routes' type is imported, never their code.
import type { ExtractSchema } from "hono/types";
import * as jarl from "jarl";
import * as Http from "./main.ts";

type Success = 200 | 201 | 202 | 203 | 204 | 205 | 206;

type PostOf<S, P> = P extends keyof S
  ? S[P] extends { readonly $post: infer E }
    ? E
    : never
  : never;
type StatusOf<E> = E extends { readonly status: infer C } ? C : never;
type BodyOf<E> = E extends { readonly input: { readonly json: infer J } } ? J : never;

// What one route's answers mean: ok for any 2xx, and a word for each other status it answers
// that is no failure. Every status it leaves out stays @oligarchy/http's error.
export type Spec<E> = { readonly ok: string; readonly timeoutMs?: number } & {
  readonly [C in Exclude<StatusOf<E>, Success> & number]?: string;
};

// One spec per route, so a route added to the app is one its callers must answer. A route with no
// POST takes never, so no client can be made over it.
export type Specs<S> = {
  readonly [P in keyof S]: [PostOf<S, P>] extends [never] ? never : Spec<PostOf<S, P>>;
};

// An inferred argument escapes the excess-property check, so a key its route does not have, a
// status included, is never.
type Exact<S, A> = {
  readonly [P in keyof A]: P extends keyof S
    ? { readonly [K in Exclude<keyof A[P], keyof Spec<PostOf<S, P>>>]: never }
    : never;
};

type Words<T> = { [K in keyof T]-?: K extends "timeoutMs" ? never : T[K] }[keyof T];

export type Client<S, A> = {
  readonly post: <P extends keyof A & keyof S & string>(
    path: P,
    body: BodyOf<PostOf<S, P>>,
  ) => Promise<jarl.Result<Words<A[P]>, Http.HttpFailure>>;
};

// signal ends any call in flight.
export type Options = {
  readonly http: Http.Http;
  readonly url: string;
  readonly token: { readonly reveal: () => string };
  readonly signal?: AbortSignal;
};

type Told = { readonly ok: string; readonly timeoutMs?: number } & {
  readonly [status: number]: string | undefined;
};

const statusOf = (error: Http.HttpFailure): number | undefined =>
  "status" in error ? error.status : undefined;

// Routes is the app's exported type: create<Routes>()(options, specs). Every call carries the
// token as its bearer, and nothing is asked again.
export const create =
  <Routes>() =>
  <const A extends Specs<ExtractSchema<Routes>>>(
    options: Options,
    specs: A & Exact<ExtractSchema<Routes>, A>,
  ): Client<ExtractSchema<Routes>, A> => {
    const base = options.url.endsWith("/") ? options.url : `${options.url}/`;
    const told: Readonly<Record<string, Told>> = specs;

    // The signature Client gives post, over a body that sees plain paths and words.
    function post<P extends keyof A & keyof ExtractSchema<Routes> & string>(
      path: P,
      body: BodyOf<PostOf<ExtractSchema<Routes>, P>>,
    ): Promise<jarl.Result<Words<A[P]>, Http.HttpFailure>>;
    async function post(
      path: string,
      body: unknown,
    ): Promise<jarl.Result<unknown, Http.HttpFailure>> {
      const spec = told[path];
      if (spec === undefined) {
        throw new Error(`no spec for ${path}`);
      }
      const answered = await options.http.fetch(
        new URL(path.replace(/^\//, ""), base).toString(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.token.reveal()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
        { decode: () => jarl.ok(spec.ok) },
      );
      if (jarl.is_err(answered)) {
        const status = statusOf(answered.error);
        const word = status === undefined ? undefined : spec[status];
        if (word !== undefined) {
          return jarl.ok(word);
        }
      }
      return answered;
    }

    return { post };
  };

// A payload/stream client for a selected method on an app's routes. The route remains the
// contract; callers never import the remote handler implementation.
type Methods<S> = { [P in keyof S]: keyof S[P] }[keyof S] & string;
type Paths<S, M extends string> = { [P in keyof S]: M extends keyof S[P] ? P : never }[keyof S] &
  string;
type Input<S, M extends string, P extends keyof S> = M extends keyof S[P]
  ? S[P][M] extends { input: infer I }
    ? I
    : never
  : never;

export const connect = <Routes>(options: Options) => {
  type S = ExtractSchema<Routes>;
  const prepare = <M extends Methods<S>, P extends Paths<S, M>>(
    method: M,
    path: P,
    input: Input<S, M, P>,
    init: Pick<Http.Init, "timeoutMs" | "signal"> = {},
  ): [string, Http.Init] => {
    const supplied: unknown = input;
    const json =
      typeof supplied === "object" && supplied !== null && "json" in supplied
        ? supplied.json
        : undefined;
    const query =
      typeof supplied === "object" && supplied !== null && "query" in supplied
        ? supplied.query
        : undefined;
    const url = new URL(
      path.replace(/^\//, ""),
      options.url.endsWith("/") ? options.url : `${options.url}/`,
    );
    if (typeof query === "object" && query !== null) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    }
    return [
      url.toString(),
      {
        method: method.slice(1).toUpperCase(),
        headers: {
          Authorization: `Bearer ${options.token.reveal()}`,
          ...(method === "$get" ? {} : { "Content-Type": "application/json" }),
        },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...init,
      },
    ];
  };
  return {
    prepare,
    request: <M extends Methods<S>, P extends Paths<S, M>>(
      method: M,
      path: P,
      input: Input<S, M, P>,
      init: Pick<Http.Init, "timeoutMs" | "signal"> = {},
    ): ReturnType<Http.Http["open"]> => options.http.open(...prepare(method, path, input, init)),
  };
};
