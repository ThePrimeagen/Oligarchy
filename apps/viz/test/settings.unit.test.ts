import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import * as Settings from "../src/settings.ts";

const file = (contents: string | undefined) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path === Settings.PATH && contents !== undefined),
    readFileString: (path) =>
      path === Settings.PATH && contents !== undefined
        ? Effect.succeed(contents)
        : Effect.die(`unexpected read ${path}`),
  });

describe("settings", () => {
  it.effect("a missing file is the default ticket count", () =>
    Effect.gen(function* () {
      expect(yield* Settings.load.pipe(Effect.provide(file(undefined)))).toEqual({
        tickets: Settings.DEFAULT_TICKETS,
      });
    }),
  );

  it.effect("a file names how many finished tickets a cycle keeps", () =>
    Effect.gen(function* () {
      expect(yield* Settings.load.pipe(Effect.provide(file('{"tickets": 10}')))).toEqual({
        tickets: 10,
      });
      expect(yield* Settings.parse("{}")).toEqual({ tickets: Settings.DEFAULT_TICKETS });
    }),
  );

  it.effect("a file that is not the shape is refused", () =>
    Effect.gen(function* () {
      const bad = yield* Effect.flip(Settings.parse('{"tickets": 0}'));
      expect(bad._tag).toBe("CommandError");
      expect(bad.message).toContain(Settings.PATH);
      expect(bad.message).toContain("tickets");
      const extra = yield* Effect.flip(Settings.parse('{"tickets": 4, "nope": true}'));
      expect(extra.message).toContain(Settings.PATH);
      const broken = yield* Effect.flip(Settings.load.pipe(Effect.provide(file("{"))));
      expect(broken._tag).toBe("CommandError");
      expect(broken.message).toContain(Settings.PATH);
    }),
  );
});
