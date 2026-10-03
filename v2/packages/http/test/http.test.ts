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
    const fake = Fake.http({ replies: Fake.json({ team: { id: "team-1" } }) });

    const team = await fake.http.fetch(URL, init, { decode: decodeTeam });

    expect(team).toEqual(jarl.ok({ id: "team-1" }));
    expect(fake.asked).toEqual([
      { url: URL, method: "POST", headers: { authorization: "key" }, body: { name: "Fixture" } },
    ]);
  });

  it("returns decode's own error when decode refuses the body (sad)", async () => {
    const fake = Fake.http({ replies: Fake.json({ teams: [] }) });

    const team = await fake.http.fetch(URL, init, { decode: decodeTeam });

    expect(Fake.failure(team, NoTeam).message).toBe("no team");
  });

  it("returns the error a named status's handler made, so a caller retries on it (sad)", async () => {
    const slow = Fake.status(429, "slow down");
    const fake = Fake.http({ replies: [slow, slow, Fake.json({ team: { id: "team-1" } })] });
    const ask = () =>
      fake.http.fetch(URL, init, {
        decode: decodeTeam,
        status: { 429: (body) => new RateLimited(`rate limited: ${body}`) },
      });

    const limited = await ask();
    expect(Fake.failure(limited, RateLimited).message).toBe("rate limited: slow down");

    const retried = await Async.repeat(ask, 2, {
      retry: (error) =>
        jarl.error.is(error, RateLimited) ? { retry: true, delay: 0 } : { retry: false },
    })();
    expect(retried).toEqual(jarl.ok({ id: "team-1" }));
    expect(fake.asked).toHaveLength(3);
  });

  it("a status's error carries the response's headers, and a named status's handler is handed them (sad)", async () => {
    const headers = { "Retry-After": "7" };
    const fake = Fake.http({
      replies: [
        Fake.status(400, "bad query", headers),
        Fake.status(404, "", headers),
        Fake.status(503, "busy", headers),
        Fake.status(418, "teapot", headers),
        Fake.status(429, "slow down", headers),
      ],
    });
    const ask = () => fake.http.fetch(URL, init, { decode: decodeTeam });

    const failures = [
      Fake.failure(await ask(), Http.HttpBadRequest),
      Fake.failure(await ask(), Http.HttpNotFound),
      Fake.failure(await ask(), Http.HttpServerError),
      Fake.failure(await ask(), Http.HttpUnhandled),
    ];
    const named = await fake.http.fetch(URL, init, {
      decode: decodeTeam,
      status: {
        429: (body, sent) =>
          new RateLimited(`${body}; again in ${sent.get("retry-after") ?? "?"}s`),
      },
    });

    expect(failures.map((failure) => failure.headers.get("retry-after"))).toEqual([
      "7",
      "7",
      "7",
      "7",
    ]);
    expect(Fake.failure(named, RateLimited).message).toBe("slow down; again in 7s");
  });

  it('read "bytes" hands decode the 2xx body\'s bytes as they came, not parsed (happy)', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    const fake = Fake.http({
      replies: new Response(png, { headers: { "Content-Type": "image/png" } }),
    });

    const image = await fake.http.fetch(URL, init, {
      read: "bytes",
      decode: (body) => jarl.ok(Array.from(body)),
    });

    expect(image).toEqual(jarl.ok(Array.from(png)));
  });

  it('read "bytes": a status\'s error still carries its body as text (sad)', async () => {
    const fake = Fake.http({ replies: Fake.status(404, "no guest for job-1") });

    const image = await fake.http.fetch(URL, init, {
      read: "bytes",
      decode: (body) => jarl.ok(Array.from(body)),
    });

    const missing = Fake.failure(image, Http.HttpNotFound);
    expect(missing.body).toBe("no guest for job-1");
    expect(missing.message).toBe(`${WHERE}: 404: no guest for job-1`);
  });

  // Bun's fetch ends a request it has no answer for within its own idle limit, whatever the
  // caller's deadline, unless it is told `timeout: false`.
  const runtime: Http.Fetch = async (_url, sent) => {
    if (sent.timeout !== false) {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return Response.json({ team: { id: "team-1" } });
  };

  it("a call that waits past the runtime's own fetch limit still answers (happy)", async () => {
    const http = Http.create({}, { fetch: runtime, timeoutMs: 2 ** 31 - 1 });

    const team = await http.fetch(URL, init, { decode: decodeTeam });

    expect(team).toEqual(jarl.ok({ id: "team-1" }));
  });

  it("a call no one answers within its own timeoutMs is still HttpTimedOut (sad)", async () => {
    const http = Http.create(
      {},
      {
        fetch: (_url, { signal }) =>
          new Promise((_, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason)),
          ),
        timeoutMs: 5,
      },
    );

    const team = await http.fetch(URL, init, { decode: decodeTeam });

    expect(Fake.failure(team, Http.HttpTimedOut).message).toBe(`${WHERE}: no answer within 5 ms`);
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
    const fake = Fake.http({ replies: reply, timeoutMs: 5 });

    const team = await fake.http.fetch(URL, signal === undefined ? init : { ...init, signal }, {
      decode: decodeTeam,
    });

    const failed = Fake.failure(team, error);
    expect(failed.message).toContain(said);
    expect(String(failed)).not.toContain("s3cret");
    expect(Http.retryable(failed)).toBe(retryable);
  });
});
