import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Http from "../src/main.ts";
import * as Fake from "../src/testing.ts";

// The query carries a secret no printed error may show.
const URL = "https://api.example/graphql?token=s3cret";
const WHERE = "POST https://api.example/graphql";

const NoTeam = jarl.error.define("NoTeam");
const RateLimited = jarl.error.define("RateLimited");

const init = {
  method: "POST",
  headers: { Authorization: "key" },
  body: JSON.stringify({ name: "Fixture" }),
};

const decodeTeam = (body: unknown) => {
  const team = typeof body === "object" && body !== null && "team" in body ? body.team : null;
  const id = typeof team === "object" && team !== null && "id" in team ? team.id : null;
  return typeof id === "string" ? jarl.ok({ id }) : jarl.err(new NoTeam("no team"));
};

describe("fetch", () => {
  it("returns what decode makes of a 2xx body, from the one request asked (happy)", async () => {
    const fake = Fake.http(Fake.json({ team: { id: "team-1" } }));

    const team = await fake.http.fetch(URL, init, { decode: decodeTeam });

    expect(team).toEqual(jarl.ok({ id: "team-1" }));
    expect(fake.asked).toEqual([
      { url: URL, method: "POST", headers: { authorization: "key" }, body: { name: "Fixture" } },
    ]);
  });

  it("returns decode's own error when decode refuses the body (sad)", async () => {
    const fake = Fake.http(Fake.json({ teams: [] }));

    const team = await fake.http.fetch(URL, init, { decode: decodeTeam });

    expect(Fake.failure(team, NoTeam).message).toBe("no team");
  });

  it("returns the error a named status's handler made, so a caller retries on it (sad)", async () => {
    const slow = Fake.status(429, "slow down");
    const fake = Fake.http([slow, slow, Fake.json({ team: { id: "team-1" } })]);
    const ask = () =>
      fake.http.fetch(URL, init, {
        decode: decodeTeam,
        status: { 429: (body) => new RateLimited(`linear: ${body}`) },
      });

    const limited = await ask();
    expect(Fake.failure(limited, RateLimited).message).toBe("linear: slow down");

    const retried = await Async.repeat(ask, 2, {
      errorFilter: (error) => jarl.error.is(error, RateLimited),
    })();
    expect(retried).toEqual(jarl.ok({ id: "team-1" }));
    expect(fake.asked).toHaveLength(3);
  });

  type Case = {
    readonly name: string;
    readonly reply: Fake.Reply;
    readonly signal?: AbortSignal;
    readonly error: abstract new (...args: never[]) => Http.HttpFailure;
    readonly said: string;
    readonly retryable: boolean;
  };

  const cases: ReadonlyArray<Case> = [
    {
      name: "a 400 is HttpBadRequest",
      reply: Fake.status(400, "bad query"),
      error: Http.HttpBadRequest,
      said: `${WHERE}: 400: bad query`,
      retryable: false,
    },
    {
      name: "a 404 is HttpNotFound",
      reply: Fake.status(404),
      error: Http.HttpNotFound,
      said: `${WHERE}: 404`,
      retryable: false,
    },
    {
      name: "a 5xx is HttpServerError",
      reply: Fake.status(503, "busy"),
      error: Http.HttpServerError,
      said: `${WHERE}: 503: busy`,
      retryable: true,
    },
    {
      name: "a status no one named is HttpUnhandled",
      reply: Fake.status(418, "teapot"),
      error: Http.HttpUnhandled,
      said: `${WHERE}: 418: teapot`,
      retryable: false,
    },
    {
      name: "an unnamed 429 is HttpUnhandled, and worth asking again",
      reply: Fake.status(429),
      error: Http.HttpUnhandled,
      said: `${WHERE}: 429`,
      retryable: true,
    },
    {
      name: "a 2xx body that is not JSON is HttpInvalid",
      reply: Fake.status(200, "<html>"),
      error: Http.HttpInvalid,
      said: `${WHERE}: body is not JSON`,
      retryable: false,
    },
    {
      name: "a fetch that throws is HttpUnreachable",
      reply: "unreachable",
      error: Http.HttpUnreachable,
      said: `${WHERE}: fetch failed`,
      retryable: true,
    },
    {
      name: "no answer in time is HttpTimedOut",
      reply: "hang",
      error: Http.HttpTimedOut,
      said: `${WHERE}: no answer within 5 ms`,
      retryable: true,
    },
    {
      name: "the caller's signal aborting is Aborted, with the signal's reason",
      reply: "hang",
      signal: AbortSignal.abort(new Async.Aborted("stopping")),
      error: Async.Aborted,
      said: "stopping",
      retryable: false,
    },
  ];

  it.each(cases)("$name (sad)", async ({ reply, signal, error, said, retryable }) => {
    const fake = Fake.http(reply, { timeoutMs: 5 });

    const team = await fake.http.fetch(URL, signal === undefined ? init : { ...init, signal }, {
      decode: decodeTeam,
    });

    const failed = Fake.failure(team, error);
    expect(failed.message).toContain(said);
    expect(String(failed)).not.toContain("s3cret");
    expect(Http.retryable(failed)).toBe(retryable);
  });
});
