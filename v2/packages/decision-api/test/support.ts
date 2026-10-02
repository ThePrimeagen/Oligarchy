import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import * as DecisionApi from "../src/main.ts";

export const ACCOUNT_ID = "a".repeat(32);
export const TOKEN = "cloudflare-test-secret";
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=";
export const REQUEST = {
  state: { goal: "Save", attempt: 1 },
  questions: {
    saved: {
      type: "noul",
      instructions: "Saved?",
      criteria: { true: "Confirmed", false: "Unconfirmed" },
    },
    action: {
      type: "choice",
      instructions: { question: "Next?", context: ["Save"] },
      criteria: { finish: "Done", wait: null },
    },
    progress: {
      type: "score",
      instructions: "Progress?",
      criteria: ["Not started", "In progress", "Done"],
    },
  },
} as const satisfies DecisionApi.Request;

export const output = () => ({
  model: "clef",
  answers: {
    saved: { type: "noul", noul: 0.9 },
    action: {
      type: "choice",
      choice: "finish",
      probabilities: { finish: 0.8, wait: 0.2 },
      confidence: 0.6,
    },
    progress: {
      type: "score",
      score: 1.7,
      probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 },
      legend: { "0": "Not started", "1": "In progress", "2": "Done" },
      confidence: 0.5,
    },
  },
  usage: { input_tokens: 120, output_tokens: 0 },
});

export const envelope = (result: unknown = output()) => ({
  success: true,
  errors: [],
  messages: [],
  result,
});
const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

export const client = async (
  replies: Fake.Options["replies"],
  options: Partial<Pick<DecisionApi.Options, "model" | "timeoutMs" | "accountId">> = {},
) => {
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "decision-api-test", description: "" }).needs("cloudflareApiToken").done(),
      Env.fakeIo({ env: { CLOUDFLARE_API_TOKEN: TOKEN }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const fake = Fake.http({ replies });
  const api = DecisionApi.create(fake, {
    accountId: ACCOUNT_ID,
    token: env.vars.cloudflareApiToken,
    timeoutMs: 20,
    ...options,
  });
  return { api, asked: fake.asked };
};
