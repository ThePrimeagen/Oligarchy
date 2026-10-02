import * as Async from "@oligarchy/async";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as DecisionApi from "../src/main.ts";
import { ACCOUNT_ID, client, envelope, output, PNG, REQUEST, TOKEN } from "./support.ts";

describe("decide", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a complete decision and returns every question's answer (happy)", async () => {
    const wire = { ...output(), model: "clef-flash" };
    const { api, asked } = await client(Fake.json(envelope(wire)));
    expect(asked).toHaveLength(0);
    const result = await api.decide({
      ...REQUEST,
      model: "clef-flash",
      images: [
        { contentType: "image/png", bytes: Buffer.from(PNG, "base64") },
        { dataUrl: `data:image/png;base64,${PNG}` },
      ],
    });
    const decision = jarl.unwrap(result);
    expect(decision).toEqual({
      model: "clef-flash",
      answers: wire.answers,
      usage: { inputTokens: 120, outputTokens: 0 },
    });
    expect(asked).toEqual([
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/cloudflare/clef-flash`,
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: {
          ...REQUEST,
          model: "clef-flash",
          images: [
            { content_type: "image/png", base64: PNG },
            { content_type: "image/png", base64: PNG },
          ],
        },
      },
    ]);
  });

  const invalidRequests: readonly { name: string; input: () => unknown }[] = [
    {
      name: "a key the record parser would discard",
      input: () => ({ state: JSON.parse('{"__proto__":"must not disappear"}') }),
    },
    { name: "no questions", input: () => ({ questions: {} }) },
    {
      name: "too many questions",
      input: () => ({
        questions: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`q${i}`, REQUEST.questions.saved]),
        ),
      }),
    },
    {
      name: "invalid question ID",
      input: () => ({ questions: { "bad id": REQUEST.questions.saved } }),
    },
    { name: "missing instructions", input: () => ({ questions: { q: { type: "noul" } } }) },
    {
      name: "empty instructions",
      input: () => ({ questions: { q: { type: "noul", instructions: "  " } } }),
    },
    {
      name: "unknown question type",
      input: () => ({ questions: { q: { type: "text", instructions: "Explain" } } }),
    },
    {
      name: "too few choices",
      input: () => ({
        questions: { q: { ...REQUEST.questions.action, criteria: { only: "One" } } },
      }),
    },
    {
      name: "too many choices",
      input: () => ({
        questions: {
          q: {
            ...REQUEST.questions.action,
            criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), null])),
          },
        },
      }),
    },
    {
      name: "empty choice ID",
      input: () => ({
        questions: {
          q: { ...REQUEST.questions.action, criteria: { "": "Empty", other: "Other" } },
        },
      }),
    },
    {
      name: "too few rubric levels",
      input: () => ({ questions: { q: { ...REQUEST.questions.progress, criteria: ["Only"] } } }),
    },
    {
      name: "too many rubric levels",
      input: () => ({
        questions: {
          q: { ...REQUEST.questions.progress, criteria: Array.from({ length: 11 }, () => "Level") },
        },
      }),
    },
    { name: "nonfinite state", input: () => ({ state: { n: Infinity } }) },
    { name: "undefined state field", input: () => ({ state: { n: undefined } }) },
    { name: "state with a serializer", input: () => ({ state: new Date() }) },
    {
      name: "cyclic state",
      input: () => {
        const state: Record<string, unknown> = {};
        state.self = state;
        return { state };
      },
    },
    { name: "missing state", input: () => ({ state: undefined }) },
    { name: "unsupported model", input: () => ({ model: "other" }) },
    { name: "invalid timeout", input: () => ({ timeoutMs: 0 }) },
    {
      name: "too many images",
      input: () => ({
        images: Array.from({ length: 5 }, () => ({ dataUrl: `data:image/png;base64,${PNG}` })),
      }),
    },
    {
      name: "remote image",
      input: () => ({ images: [{ dataUrl: "https://example.com/screen.png" }] }),
    },
    {
      name: "malformed base64",
      input: () => ({ images: [{ dataUrl: "data:image/png;base64,abc==" }] }),
    },
    {
      name: "unreadable image",
      input: () => ({ images: [{ contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) }] }),
    },
    {
      name: "empty image",
      input: () => ({ images: [{ contentType: "image/png", bytes: new Uint8Array() }] }),
    },
    {
      name: "mislabeled image",
      input: () => ({ images: [{ contentType: "image/jpeg", bytes: Buffer.from(PNG, "base64") }] }),
    },
    {
      name: "oversized image bytes",
      input: () => ({
        images: [{ contentType: "image/png", bytes: new Uint8Array(4 * 1024 * 1024 + 1) }],
      }),
    },
    {
      name: "oversized image data URL",
      input: () => ({
        images: [{ dataUrl: `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}` }],
      }),
    },
    {
      name: "oversized image dimensions",
      input: () => {
        const bytes = Buffer.from(PNG, "base64");
        bytes.writeUInt32BE(5000, 16);
        bytes.writeUInt32BE(5000, 20);
        return { images: [{ contentType: "image/png", bytes }] };
      },
    },
    {
      name: "oversized combined images",
      input: () => {
        const bytes = Buffer.alloc(3 * 1024 * 1024);
        Buffer.from(PNG, "base64").copy(bytes);
        return { images: Array.from({ length: 3 }, () => ({ contentType: "image/png", bytes })) };
      },
    },
    { name: "oversized JSON body", input: () => ({ state: "x".repeat(13 * 1024 * 1024) }) },
  ];

  it.each(invalidRequests)("refuses $name before sending", async ({ input }) => {
    const { api, asked } = await client(Fake.json(envelope()));
    const request = Object.assign({}, REQUEST, input()) as DecisionApi.Request;
    const result = await api.decide(request);
    expect(jarl.error.is(result, DecisionApi.InvalidRequest)).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it("returns invalid configuration on use, without making creation fail", async () => {
    const { api, asked } = await client(Fake.json(envelope()), { accountId: "" });
    expect(jarl.error.is(await api.decide(REQUEST), DecisionApi.InvalidRequest)).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it.each([
    { status: 400, code: 5004, error: DecisionApi.Refused },
    { status: 401, code: 10000, error: DecisionApi.Refused },
    { status: 403, code: 5018, error: DecisionApi.Refused },
    { status: 404, code: 3042, error: DecisionApi.Refused },
    { status: 413, code: 3006, error: DecisionApi.Refused },
    { status: 429, code: 3040, error: DecisionApi.RateLimited },
    { status: 429, code: 3036, error: DecisionApi.RateLimited },
    { status: 408, code: 3007, error: DecisionApi.TimedOut },
    { status: 504, code: 3007, error: DecisionApi.TimedOut },
    { status: 503, code: 9999, error: DecisionApi.Unavailable },
  ])("preserves provider $status/$code and never retries", async ({ status, code, error }) => {
    const { api, asked } = await client(
      Fake.json({ success: false, errors: [{ code, message: "provider detail" }] }, status, {
        "Retry-After": "3",
      }),
    );
    const result = await api.decide(REQUEST);
    const failure = Fake.failure<DecisionApi.Failure>(result, error);
    expect(failure).toMatchObject({
      status,
      codes: [code],
      retryAfter: "3",
      message: "provider detail",
    });
    expect(asked).toHaveLength(1);
  });

  it.each([
    { code: 3040, error: DecisionApi.RateLimited },
    { code: 3008, error: DecisionApi.TimedOut },
    { code: 5004, error: DecisionApi.Refused },
  ])("handles provider error $code inside HTTP 200", async ({ code, error }) => {
    const { api } = await client(
      Fake.json({ ...envelope(), success: false, errors: [{ code, message: "failed" }] }),
    );
    expect(Fake.failure<DecisionApi.Failure>(await api.decide(REQUEST), error)).toMatchObject({
      codes: [code],
      message: "failed",
    });
  });

  it("keeps transport failures out of the success path", async () => {
    const { api, asked } = await client("unreachable");
    const result = await api.decide(REQUEST);
    expect(jarl.error.is(result, DecisionApi.Unavailable)).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("handles a non-JSON provider refusal", async () => {
    const { api } = await client(Fake.status(502, "Bad gateway"));
    expect(Fake.failure(await api.decide(REQUEST), DecisionApi.Unavailable)).toMatchObject({
      status: 502,
      codes: [],
    });
  });

  it("ends a hanging request at its overridden timeout", async () => {
    const { api, asked } = await client("hang");
    const pending = api.decide({ ...REQUEST, timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    expect(jarl.error.is(await pending, DecisionApi.TimedOut)).toBe(true);
    expect(asked).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("preserves cancellation (already aborted: %s)", async (alreadyAborted) => {
    const { api, asked } = await client("hang");
    const controller = new AbortController();
    const reason = new Async.Aborted("job stopped");
    if (alreadyAborted) controller.abort(reason);
    const pending = api.decide({ ...REQUEST, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    if (!alreadyAborted) controller.abort(reason);
    expect(await pending).toEqual(jarl.err(reason));
    expect(asked).toHaveLength(alreadyAborted ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  const invalidResponses: readonly { name: string; response: () => unknown }[] = [
    { name: "missing envelope", response: output },
    { name: "missing result", response: () => ({ success: true, errors: [] }) },
    { name: "wrong model", response: () => envelope({ ...output(), model: "clef-flash" }) },
    {
      name: "missing question",
      response: () => {
        const value = output();
        return envelope({ ...value, answers: { saved: value.answers.saved } });
      },
    },
    {
      name: "extra question",
      response: () => {
        const value = output();
        return envelope({ ...value, answers: { ...value.answers, surprise: value.answers.saved } });
      },
    },
    {
      name: "wrong answer type",
      response: () => {
        const value = output();
        return envelope({ ...value, answers: { ...value.answers, saved: value.answers.action } });
      },
    },
    {
      name: "invalid probability",
      response: () => {
        const value = output();
        value.answers.saved.noul = 2;
        return envelope(value);
      },
    },
    {
      name: "unknown choice",
      response: () => {
        const value = output();
        value.answers.action.choice = "unknown";
        return envelope(value);
      },
    },
    {
      name: "choice not highest probability",
      response: () => {
        const value = output();
        value.answers.action.choice = "wait";
        return envelope(value);
      },
    },
    {
      name: "missing choice probability",
      response: () => {
        const value = output();
        return envelope({
          ...value,
          answers: {
            ...value.answers,
            action: { ...value.answers.action, probabilities: { finish: 1 } },
          },
        });
      },
    },
    {
      name: "probability sum",
      response: () => {
        const value = output();
        value.answers.action.probabilities.finish = 0.4;
        return envelope(value);
      },
    },
    {
      name: "invalid confidence",
      response: () => {
        const value = output();
        value.answers.action.confidence = -1;
        return envelope(value);
      },
    },
    {
      name: "unknown score level",
      response: () => {
        const value = output();
        return envelope({
          ...value,
          answers: {
            ...value.answers,
            progress: {
              ...value.answers.progress,
              probabilities: { "0": 0.1, "1": 0.1, "3": 0.8 },
            },
          },
        });
      },
    },
    {
      name: "missing legend level",
      response: () => {
        const value = output();
        return envelope({
          ...value,
          answers: {
            ...value.answers,
            progress: { ...value.answers.progress, legend: { "0": "Only" } },
          },
        });
      },
    },
    {
      name: "score outside rubric",
      response: () => {
        const value = output();
        value.answers.progress.score = 3;
        return envelope(value);
      },
    },
    {
      name: "score not weighted expectation",
      response: () => {
        const value = output();
        value.answers.progress.score = 1;
        return envelope(value);
      },
    },
    {
      name: "invalid usage",
      response: () => {
        const value = output();
        value.usage.input_tokens = -1;
        return envelope(value);
      },
    },
  ];

  it.each(invalidResponses)(
    "rejects $name instead of returning a falsely typed answer",
    async ({ response }) => {
      const { api } = await client(Fake.json(response()));
      expect(jarl.error.is(await api.decide(REQUEST), DecisionApi.InvalidResponse)).toBe(true);
    },
  );

  it("rejects a successful HTTP response that is not JSON", async () => {
    const { api } = await client(Fake.status(200, "not JSON"));
    expect(jarl.error.is(await api.decide(REQUEST), DecisionApi.InvalidResponse)).toBe(true);
  });

  it("uses the sent question snapshot when the caller mutates questions in flight", async () => {
    const request = structuredClone(REQUEST);
    const { api } = await client(() => {
      Object.assign(request.questions, { surprise: REQUEST.questions.saved });
      return Fake.json(envelope());
    });
    expect(jarl.is_ok(await api.decide(request))).toBe(true);
  });
});
