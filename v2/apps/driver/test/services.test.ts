import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as Fake from "@oligarchy/http/testing";
import * as OpenRouter from "@oligarchy/openrouter";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openRouterOptions } from "../src/services.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

const CONFIG = {
  openRouterBaseUrl: "https://openrouter.test/api/v1",
  driver: { askTimeout: 180_000, harness: { defaultRetry: 1_000, recentActions: 10 } },
};
const vars = async () =>
  jarl.unwrap(
    await Env.create(
      Env.cli({ name: "driver-test", description: "" }).needs("openRouterToken").done(),
      Env.fakeIo({
        env: { OPENROUTER_API_KEY: "key" },
        files: { [Env.CONFIG_PATH]: readFileSync(Env.CONFIG_PATH, "utf8") },
      }),
    ),
  ).vars;

const overloaded = () => Fake.status(503, JSON.stringify({ error: "Provider returned error" }));
const answered = () => Fake.json({ choices: [{ message: { content: null, tool_calls: [] } }] });

const ask = async (replies: Fake.Options["replies"], deadline: number) => {
  const fake = Fake.http({ replies });
  const openRouter = OpenRouter.create(
    { http: fake.http },
    openRouterOptions({ vars: await vars(), config: CONFIG }),
  );
  const turn = openRouter.complete({
    model: "meta/drive",
    messages: [{ role: "user", content: "go" }],
    tools: [],
    reasoning: "minimal",
    deadline,
  });
  return { turn, asked: fake.asked };
};

it("asks again through a provider outage until it answers, within the run's deadline", async () => {
  const replies = [...Array.from({ length: 9 }, overloaded), answered()];
  const { turn, asked } = await ask(replies, Date.now() + 60_000);

  await vi.advanceTimersByTimeAsync(10_000);

  expect(jarl.unwrap(await turn)).toEqual({ content: null, toolCalls: [] });
  expect(asked).toHaveLength(10);
});

it("stops asking once a wait to ask again would reach the run's deadline", async () => {
  const { turn, asked } = await ask(() => overloaded(), Date.now() + 5_500);

  await vi.advanceTimersByTimeAsync(10_000);

  const result = await turn;
  expect(jarl.error.is(result, OpenRouter.OpenRouterOutOfTime)).toBe(true);
  expect(asked).toHaveLength(6);
});
