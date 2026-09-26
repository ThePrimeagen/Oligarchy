import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Stdio, Stream } from "effect";
import * as TestingStdio from "../src/stdio.ts";

describe("capture happy path", () => {
  it.effect("keeps stdout and stderr apart, byte for byte, and answers the given args", () =>
    Effect.gen(function* () {
      const captured = TestingStdio.capture({ args: ["--help"] });
      const args = yield* Effect.gen(function* () {
        const stdio = yield* Stdio.Stdio;
        yield* Stream.run(Stream.make("out ", new Uint8Array([0x6f, 0x6b])), stdio.stdout());
        yield* Stream.run(Stream.make("err"), stdio.stderr());
        return yield* stdio.args;
      }).pipe(Effect.provide(captured.layer));
      expect(args).toEqual(["--help"]);
      expect(TestingStdio.text(captured.stdout)).toBe("out ok");
      expect(TestingStdio.text(captured.stderr)).toBe("err");
    }),
  );
});

describe("capture unhappy path", () => {
  it.effect("with nothing given, there are no args and stdout is not a terminal", () =>
    Effect.gen(function* () {
      const captured = TestingStdio.capture();
      const [args, terminal] = yield* Effect.gen(function* () {
        const stdio = yield* Stdio.Stdio;
        return [yield* stdio.args, yield* stdio.stdoutIsTerminal] as const;
      }).pipe(Effect.provide(captured.layer));
      expect(args).toEqual([]);
      expect(terminal).toBe(false);
      expect(captured.stdout).toEqual([]);
    }),
  );
});
