import { readFileSync } from "node:fs";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Config from "../src/config.ts";
import * as Errors from "../src/errors.ts";
import * as Io from "../src/io.ts";

const valid = {
  models: {
    drive: "meta/muse-spark-1.3-contributor",
    diagnose: "meta/muse-spark-1.3-contributor",
    mint: "meta/muse-spark-1.3-contributor",
  },
  reasoning: { drive: "minimal", diagnose: "xhigh", mint: "minimal" },
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  timeouts: { header: "3 minutes", chunk: "3 minutes" },
  runCeiling: "1.5 hours",
  stepLimit: 200,
  harness: { defaultRetry: "1 second" },
};

const loadText = (text: string) => Config.load(Io.fake({ files: { [Config.PATH]: text } }));

const refusal = async (file: object): Promise<string> => {
  const result = await loadText(JSON.stringify(file));
  if (!jarl.error.is(result, Errors.ConfigInvalid)) {
    throw new Error("expected ConfigInvalid");
  }
  return result.error.message;
};

describe("load", () => {
  it("loads the checked-in oligarchy.json (happy)", async () => {
    expect(jarl.is_ok(await loadText(readFileSync(Config.PATH, "utf8")))).toBe(true);
  });

  it("turns every duration into milliseconds (happy)", async () => {
    const config = jarl.unwrap(await loadText(JSON.stringify(valid)));
    expect(config.timeouts).toEqual({ header: 180_000, chunk: 180_000 });
    expect(config.runCeiling).toBe(5_400_000);
    expect(config.harness.defaultRetry).toBe(1_000);
    expect(config.reasoning.diagnose).toBe("xhigh");
  });

  it("refuses a missing file rather than guessing a default (unhappy)", async () => {
    const result = await Config.load(Io.fake());
    if (!jarl.error.is(result, Errors.FileMissing)) {
      throw new Error("expected FileMissing");
    }
    expect(result.error.message).toBe(`${Config.PATH}: file is missing`);
  });

  it("refuses a file that cannot be read (unhappy)", async () => {
    const result = await Config.load(Io.fake({ unreadable: [Config.PATH] }));
    expect(jarl.error.is(result, Errors.FileUnreadable)).toBe(true);
  });

  it("refuses text that is not JSON, naming the file (unhappy)", async () => {
    const result = await loadText("{ not json");
    if (!jarl.error.is(result, Errors.ConfigInvalid)) {
      throw new Error("expected ConfigInvalid");
    }
    expect(result.error.message).toMatch(new RegExp(`^${Config.PATH}: `));
  });

  it("refuses a token key: the token stays in the environment (unhappy)", async () => {
    expect(await refusal({ ...valid, token: "sk-or-1" })).toContain("token");
  });

  it("names a field whose duration it cannot read (unhappy)", async () => {
    expect(await refusal({ ...valid, runCeiling: "soon" })).toMatch(
      new RegExp(`^${Config.PATH}: runCeiling: `),
    );
  });

  it("refuses a zero duration (unhappy)", async () => {
    expect(await refusal({ ...valid, harness: { defaultRetry: "0 seconds" } })).toBe(
      `${Config.PATH}: harness.defaultRetry: duration must be greater than zero`,
    );
  });

  it("refuses a timeout that does not fit under the run ceiling (unhappy)", async () => {
    expect(await refusal({ ...valid, timeouts: { header: "2 hours", chunk: "3 minutes" } })).toBe(
      `${Config.PATH}: timeouts.header: must be shorter than runCeiling`,
    );
  });

  it("refuses a step limit below one (unhappy)", async () => {
    expect(await refusal({ ...valid, stepLimit: 0 })).toBe(
      `${Config.PATH}: stepLimit: stepLimit must be at least 1`,
    );
  });

  it("refuses a model that is not provider/model (unhappy)", async () => {
    expect(await refusal({ ...valid, models: { ...valid.models, drive: "muse" } })).toBe(
      `${Config.PATH}: models.drive: model must be provider/model`,
    );
  });

  it("resolves a readFile that throws as Unexpected instead of rejecting (unhappy)", async () => {
    const io = {
      ...Io.fake(),
      readFile: async (): Promise<never> => {
        throw new TypeError("fs exploded");
      },
    };
    expect(jarl.error.is(await Config.load(io), Errors.Unexpected)).toBe(true);
  });
});
