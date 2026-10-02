import * as jarl from "jarl";
import * as z from "zod";
import * as Errors from "./errors.ts";
import { Content } from "./request.ts";
import type * as Types from "./types.ts";

const Probability = z.number().min(0).max(1);
const Probabilities = z.record(z.string(), Probability);
const Answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: Probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: Probabilities,
    confidence: Probability,
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    probabilities: Probabilities,
    legend: z.record(z.string(), Content),
    confidence: Probability,
  }),
]);
const Output = z.object({
  model: z.enum(["clef", "clef-flash"]),
  answers: z.record(z.string(), Answer),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
const Envelope = z.object({
  success: z.boolean(),
  errors: z.array(z.unknown()),
  result: z.unknown().optional(),
});
const TOLERANCE = 0.0001;
const sameKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const invalid = (reason: string) => jarl.err(new Errors.InvalidResponse(reason));

// The overload promises only what the checks below establish against this call's
// question snapshot. No caller-supplied output type or unchecked cast is needed.
export function decode<Q extends Types.Questions>(
  body: unknown,
  questions: Q,
  model: Types.Model,
): jarl.Result<Types.Response<Q>, Types.Failure>;
export function decode(
  body: unknown,
  questions: Types.Questions,
  model: Types.Model,
): jarl.Result<Types.Response, Types.Failure> {
  const envelope = Envelope.safeParse(body);
  if (!envelope.success) return invalid("invalid Cloudflare response envelope");
  if (!envelope.data.success || envelope.data.errors.length > 0) {
    return jarl.err(Errors.providerFailure(envelope.data));
  }
  const output = Output.safeParse(envelope.data.result);
  if (!output.success) return invalid("invalid decision response");
  const answer = output.data;
  if (answer.model !== model) return invalid("response model does not match request");
  if (!sameKeys(answer.answers, Object.keys(questions)))
    return invalid("response question IDs do not match request");
  for (const [id, question] of Object.entries(questions)) {
    const found = answer.answers[id];
    if (found === undefined || found.type !== question.type)
      return invalid(`answer type does not match question ${id}`);
    if (found.type === "noul") continue;
    const keys =
      question.type === "score"
        ? question.criteria.map((_, index) => String(index))
        : Object.keys(question.criteria ?? {});
    if (!sameKeys(found.probabilities, keys))
      return invalid(`probability keys do not match question ${id}`);
    const sum = Object.values(found.probabilities).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > TOLERANCE) return invalid(`probabilities do not sum to 1 for ${id}`);
    if (found.type === "choice") {
      const chosen = found.probabilities[found.choice];
      if (
        chosen === undefined ||
        !Object.hasOwn(found.probabilities, found.choice) ||
        chosen + TOLERANCE < Math.max(...Object.values(found.probabilities))
      ) {
        return invalid(`choice is not a highest-probability option for ${id}`);
      }
    } else {
      if (!sameKeys(found.legend, keys)) return invalid(`legend keys do not match question ${id}`);
      const expected = Object.entries(found.probabilities).reduce(
        (total, [key, value]) => total + Number(key) * value,
        0,
      );
      if (
        found.score < 0 ||
        found.score > keys.length - 1 ||
        Math.abs(found.score - expected) > TOLERANCE * keys.length
      ) {
        return invalid(`score does not match the rubric probabilities for ${id}`);
      }
    }
  }
  return jarl.ok({
    model: answer.model,
    answers: answer.answers,
    usage: { inputTokens: answer.usage.input_tokens, outputTokens: answer.usage.output_tokens },
  });
}
