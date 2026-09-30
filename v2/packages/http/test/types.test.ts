// Type checks only: check:types fails when one breaks. Nothing here sends a request.
import * as jarl from "jarl";
import { describe, expectTypeOf, it } from "vitest";
import type * as Http from "../src/main.ts";
import * as Fake from "../src/testing.ts";

const NoTeam = jarl.error.define("NoTeam");
type NoTeam = InstanceType<typeof NoTeam>;
const RateLimited = jarl.error.define("RateLimited");
type RateLimited = InstanceType<typeof RateLimited>;

type Team = { readonly id: string };
const decodeTeam = (body: unknown): jarl.Result<Team, NoTeam> =>
  typeof body === "string" ? jarl.ok({ id: body }) : jarl.err(new NoTeam("no team"));

const { http } = Fake.http(Fake.json({}));

describe("fetch types", () => {
  it("infers the value from decode, and the errors from decode and the named statuses", () => {
    const named = () =>
      http.fetch("u", {}, { decode: decodeTeam, status: { 429: () => new RateLimited("x") } });
    const bare = () => http.fetch("u", {}, { decode: decodeTeam });
    const withHeaders = () =>
      http.fetch(
        "u",
        {},
        {
          decode: decodeTeam,
          status: { 429: (body, headers) => new RateLimited(headers.get("retry-after") ?? body) },
        },
      );

    expectTypeOf<Awaited<ReturnType<typeof named>>>().toEqualTypeOf<
      jarl.Result<Team, NoTeam | RateLimited | Http.HttpFailure>
    >();
    expectTypeOf<Awaited<ReturnType<typeof withHeaders>>>().toEqualTypeOf<
      jarl.Result<Team, NoTeam | RateLimited | Http.HttpFailure>
    >();
    expectTypeOf<Awaited<ReturnType<typeof bare>>>().toEqualTypeOf<
      jarl.Result<Team, NoTeam | Http.HttpFailure>
    >();
  });

  it("refuses a status that is always handled, and a handler that is not a plain error", () => {
    const decode = decodeTeam;
    const error = () => new RateLimited("x");
    // @ts-expect-error 400 is always HttpBadRequest
    void (() => http.fetch("u", {}, { decode, status: { 400: error } }));
    // @ts-expect-error 404 is always HttpNotFound
    void (() => http.fetch("u", {}, { decode, status: { 404: error } }));
    // @ts-expect-error a 5xx is always HttpServerError
    void (() => http.fetch("u", {}, { decode, status: { 503: error } }));
    // @ts-expect-error a 2xx always goes to decode
    void (() => http.fetch("u", {}, { decode, status: { 201: error } }));
    // @ts-expect-error a handler returns its error, not a promise of one
    void (() => http.fetch("u", {}, { decode, status: { 429: async () => error() } }));
    // @ts-expect-error a handler returns an error
    void (() => http.fetch("u", {}, { decode, status: { 429: () => "slow" } }));
  });
});
