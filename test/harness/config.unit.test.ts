import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Duration, Effect, FileSystem, PlatformError } from "effect";
import * as HarnessConfig from "../../src/harness/config.ts";

const MODEL = "meta/muse-spark-1.3-contributor";

const valid = () => ({
  models: { drive: MODEL, diagnose: MODEL, mint: MODEL },
  reasoning: { drive: "minimal", diagnose: "low", mint: "high" },
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  timeouts: { header: "3 minutes", chunk: "3 minutes" },
  runCeiling: "1.5 hours",
  stepLimit: 200,
  harness: { defaultRetry: "1 second" },
});

const file = (
  contents: string | undefined,
  read?: Effect.Effect<string, PlatformError.PlatformError>,
) =>
  FileSystem.layerNoop({
    exists: (path) => {
      if (path !== HarnessConfig.PATH) {
        return Effect.die(`unexpected exists ${path}`);
      }
      return Effect.succeed(contents !== undefined || read !== undefined);
    },
    readFileString: (path) => {
      if (path !== HarnessConfig.PATH) {
        return Effect.die(`unexpected read ${path}`);
      }
      if (read !== undefined) {
        return read;
      }
      return contents === undefined
        ? Effect.die(`unexpected read ${path}`)
        : Effect.succeed(contents);
    },
  });

const denied = PlatformError.systemError({
  _tag: "PermissionDenied",
  module: "FileSystem",
  method: "readFileString",
  pathOrDescriptor: HarnessConfig.PATH,
  syscall: "readFileString",
  cause: new Error(`EACCES: permission denied, readFileString '${HarnessConfig.PATH}'`),
});

describe("oligarchy.json", () => {
  it.effect(
    "decodes the model per action, the base URL, the timeouts, the ceiling, the step limit and the harness",
    () =>
      Effect.gen(function* () {
        const config = yield* HarnessConfig.load.pipe(
          Effect.provide(file(JSON.stringify(valid()))),
        );
        expect(config.models).toEqual({ drive: MODEL, diagnose: MODEL, mint: MODEL });
        expect(config.reasoning).toEqual({ drive: "minimal", diagnose: "low", mint: "high" });
        expect(config.openRouterBaseUrl).toBe("https://openrouter.ai/api/v1");
        expect(Duration.toMillis(config.timeouts.header)).toBe(Duration.toMillis("3 minutes"));
        expect(Duration.toMillis(config.timeouts.chunk)).toBe(Duration.toMillis("3 minutes"));
        expect(Duration.toMillis(config.runCeiling)).toBe(Duration.toMillis("1.5 hours"));
        expect(Duration.toMillis(config.harness.defaultRetry)).toBe(Duration.toMillis("1 second"));
        expect(config.stepLimit).toBe(200);
      }),
  );

  it.effect("the checked-in file is the one startup decodes", () =>
    Effect.gen(function* () {
      const config = yield* HarnessConfig.parse(readFileSync(HarnessConfig.PATH, "utf8"));
      expect(config.models.drive).toBe(MODEL);
      expect(config.models.diagnose).toBe(MODEL);
      expect(config.models.mint).toBe(MODEL);
      expect(config.reasoning).toEqual({ drive: "minimal", diagnose: "minimal", mint: "minimal" });
      expect(config.openRouterBaseUrl).toBe("https://openrouter.ai/api/v1");
      expect(Duration.toMillis(config.timeouts.header)).toBe(Duration.toMillis("3 minutes"));
      expect(Duration.toMillis(config.timeouts.chunk)).toBe(Duration.toMillis("3 minutes"));
      expect(Duration.toMillis(config.runCeiling)).toBe(Duration.toMillis("1.5 hours"));
      expect(Duration.toMillis(config.harness.defaultRetry)).toBe(Duration.toMillis("1 second"));
      expect(config.stepLimit).toBeGreaterThanOrEqual(1);
      expect(Duration.toMillis(config.runCeiling)).toBeGreaterThan(
        Duration.toMillis(config.timeouts.header),
      );
    }),
  );

  it.effect("a missing file fails startup and names the file", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(HarnessConfig.load.pipe(Effect.provide(file(undefined))));
      expect(error._tag).toBe("CommandError");
      expect(error.message).toContain(HarnessConfig.PATH);
      expect(error.message).toContain("missing");
    }),
  );

  it.effect("an unreadable file fails startup and names the file", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        HarnessConfig.load.pipe(Effect.provide(file(undefined, Effect.fail(denied)))),
      );
      expect(error._tag).toBe("CommandError");
      expect(error.message).toContain(HarnessConfig.PATH);
      expect(error.message.toLowerCase()).toContain("permission");
    }),
  );

  it.effect("a malformed file fails startup and names the field", () =>
    Effect.gen(function* () {
      const refuse = (body: unknown) =>
        Effect.flip(HarnessConfig.parse(typeof body === "string" ? body : JSON.stringify(body)));

      const broken = yield* refuse("{");
      expect(broken._tag).toBe("CommandError");
      expect(broken.message).toContain(HarnessConfig.PATH);

      const missingDrive = yield* refuse({
        ...valid(),
        models: { diagnose: MODEL, mint: MODEL },
      });
      expect(missingDrive.message).toContain(HarnessConfig.PATH);
      expect(missingDrive.message).toContain('["models"]["drive"]');

      const badModel = valid();
      badModel.models.drive = "muse";
      const model = yield* refuse(badModel);
      expect(model.message).toContain('["models"]["drive"]');

      const missingReasoning = yield* refuse({
        ...valid(),
        reasoning: { diagnose: "minimal", mint: "minimal" },
      });
      expect(missingReasoning.message).toContain('["reasoning"]["drive"]');

      const { reasoning: _noReasoning, ...withoutReasoning } = valid();
      const noReasoning = yield* refuse(withoutReasoning);
      expect(noReasoning.message).toContain('["reasoning"]');

      const badEffort = yield* refuse({
        ...valid(),
        reasoning: { drive: "max", diagnose: "minimal", mint: "minimal" },
      });
      expect(badEffort.message).toContain('["reasoning"]["drive"]');

      const badUrl = valid();
      badUrl.openRouterBaseUrl = "not-a-url";
      const url = yield* refuse(badUrl);
      expect(url.message).toContain('["openRouterBaseUrl"]');

      const badSteps = valid();
      badSteps.stepLimit = 0;
      const steps = yield* refuse(badSteps);
      expect(steps.message).toContain('["stepLimit"]');

      const zeroHeader = valid();
      zeroHeader.timeouts.header = "0 seconds";
      const header = yield* refuse(zeroHeader);
      expect(header.message).toContain('["timeouts"]["header"]');

      const pastCeiling = valid();
      pastCeiling.timeouts.header = "2 hours";
      const ceiling = yield* refuse(pastCeiling);
      expect(ceiling.message).toContain('["timeouts"]["header"]');
      expect(ceiling.message).toContain("runCeiling");

      const chunkAtCeiling = valid();
      chunkAtCeiling.timeouts.chunk = "1.5 hours";
      const chunk = yield* refuse(chunkAtCeiling);
      expect(chunk.message).toContain('["timeouts"]["chunk"]');
      expect(chunk.message).toContain("runCeiling");

      const { harness: _dropped, ...withoutHarness } = valid();
      const missingHarness = yield* refuse(withoutHarness);
      expect(missingHarness.message).toContain('["harness"]');

      const missingRetry = yield* refuse({ ...valid(), harness: {} });
      expect(missingRetry.message).toContain('["harness"]["defaultRetry"]');

      const zeroRetry = valid();
      zeroRetry.harness.defaultRetry = "0 seconds";
      const retry = yield* refuse(zeroRetry);
      expect(retry.message).toContain('["harness"]["defaultRetry"]');

      const retryAtCeiling = valid();
      retryAtCeiling.harness.defaultRetry = "1.5 hours";
      const longRetry = yield* refuse(retryAtCeiling);
      expect(longRetry.message).toContain('["harness"]["defaultRetry"]');
      expect(longRetry.message).toContain("runCeiling");

      const flatRetry = yield* refuse({ ...valid(), defaultRetry: "1 second" });
      expect(flatRetry.message).toContain('["defaultRetry"]');

      const withToken = { ...valid(), token: "secret-token" };
      const token = yield* refuse(withToken);
      expect(token.message).toContain('["token"]');
      expect(token.message).not.toContain("secret-token");
    }),
  );
});
