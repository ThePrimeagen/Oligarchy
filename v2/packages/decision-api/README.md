# Decision API

Cloudflare Clef decisions through V2's HTTP service. Create once, then pass state,
images, and questions to each `decide` call. Responses infer their keys, answer
types, choices, and score-level keys from the questions.

## Create

Have the app's environment declare `.needs("cloudflareAccountId", "cloudflareApiToken")`.
These read `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; the token stays an
`Env.Secret` until used in the authorization header.

```ts
import * as App from "@oligarchy/app";
import * as DecisionApi from "@oligarchy/decision-api";
import * as Http from "@oligarchy/http";

const http = Http.create({});
const dependencies = { http };
const decisionApi = DecisionApi.create(dependencies, {
  accountId: env.vars.cloudflareAccountId,
  token: env.vars.cloudflareApiToken,
});

const services = {
  ...dependencies,
  "decision-api": decisionApi,
} satisfies App.Needs<Http.Http | DecisionApi.DecisionApi>;
```

Creation is synchronous and does no network work. The returned object is an
`App.Made<DecisionApi.DecisionApi>` with `service: "decision-api"` and `decide`.
Defaults are `model: "clef"` and `timeoutMs: 10_000`; either can be overridden at
creation or per call. The other supported model is `"clef-flash"`.

## Decide

```ts
import * as jarl from "jarl";

const result = await services["decision-api"].decide({
  state: {
    goal: "Save the document",
    lastAction: "Clicked Save",
    imageOrder: ["current screen"],
  },
  images: [{ contentType: "image/png", bytes: screenshot }],
  questions: {
    saved: {
      type: "noul",
      instructions: "Does the screen confirm the document was saved?",
    },
    nextAction: {
      type: "choice",
      instructions: "What should the driver do next?",
      criteria: { finish: "Saving succeeded", wait: "Saving is in progress" },
    },
    progress: {
      type: "score",
      instructions: "How far has saving progressed?",
      criteria: ["Not started", "In progress", "Completed"],
    },
  },
  signal,
});

if (jarl.is_err(result)) return result;
const decision = jarl.value(result);

decision.answers.saved.noul;                  // number: probability of yes
decision.answers.nextAction.choice;           // "finish" | "wait"
decision.answers.nextAction.probabilities;    // { finish: number; wait: number }
decision.answers.progress.probabilities;      // { "0": number; "1": number; "2": number }
decision.answers.progress.score;              // number between 0 and 2, possibly fractional
decision.usage;                               // { inputTokens, outputTokens }
```

No generic arguments or casts are needed for an inline request. For reusable
questions, use `as const satisfies DecisionApi.Questions`. An explicit
`: DecisionApi.Questions` annotation widens away the known question names.
Questions loaded from JSON need runtime validation and have broader static types.

State is JSON; instructions and criteria can include structured JSON. Cycles,
non-JSON values, and the `__proto__` key are refused before serialization. Every
question requires instructions. `noul` optionally accepts `criteria.true` and
`criteria.false`; `choice` needs 2–255 named options; `score` needs 2–10 ordered
levels. There must be 1–64 questions. IDs use letters, digits, `_`, `.`, or `-`,
with at most 100 characters.

Images accept `{ contentType, bytes }` or `{ dataUrl }`. Supported types are PNG,
JPEG, and WebP. Images retain their array order. Limits are four images, 4 MiB and
16 million pixels per image, 8 MiB of combined decoded image bytes, and 13 MiB for
the serialized request. Data URLs must contain canonical base64. Remote image
URLs are refused. Local checks inspect image headers; Cloudflare performs full
image decoding and can still refuse corrupt pixel data.

The service snapshots each request and keeps no conversation state. It makes one
HTTP attempt, validates returned answers against the sent questions, and returns
the probabilities unchanged. The caller owns action thresholds. A low-confidence
decision is a successful result. Long state is not truncated locally; Cloudflare
may truncate it to fit the model's context window.

## Failures

`decide` returns a Jarl result with this error union:

| Error | Meaning |
| --- | --- |
| `InvalidRequest` | Request or configuration failed local validation |
| `Refused` | Cloudflare rejected the request or credentials |
| `RateLimited` | Capacity, allocation, or rate limit |
| `Unavailable` | Transport failure or provider unavailability |
| `InvalidResponse` | Malformed response or answers inconsistent with the questions |
| `TimedOut` | Local or provider timeout |
| `Async.Aborted` | Caller cancelled; the original `Async.Aborted` reason is preserved |

Provider failures retain available `status`, `codes`, and `retryAfter` fields.
The service does not retry automatically. In particular, Cloudflare uses 429 for
both temporary capacity limits and exhausted allocation.

## Fake

```ts
import * as Fake from "@oligarchy/decision-api/testing";

const fake = Fake.decisionApi({
  reply: jarl.ok({
    model: "clef",
    answers: { saved: { type: "noul", noul: 0.99 } },
    usage: { inputTokens: 10, outputTokens: 0 },
  }),
});

// Pass fake to a consumer that needs App.Needs<DecisionApi.DecisionApi>.
// fake.asked records calls. reply can also be a function of the request.
const failing = Fake.decisionApi({
  reply: jarl.err(new DecisionApi.Unavailable("offline")),
});
```

The fake accepts every member of `Failure` and validates successful fixtures
against the questions. Use its optional `model` to mirror a service configured
with `clef-flash`. Run tests with fake timers, as required by V2.

## Provider references

- [Hosted input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json)
- [Hosted output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)
- [REST authentication and response envelope](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)
- [Provider errors](https://developers.cloudflare.com/workers-ai/platform/errors/)

This package uses the hosted API. Video and optional instructions in the open
model's local Python interface are outside its contract.
