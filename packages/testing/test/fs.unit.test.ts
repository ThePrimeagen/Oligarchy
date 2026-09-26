import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as TestingFs from "../src/fs.ts";

describe("recordingFs happy path", () => {
  it.effect("answers the scripted table and records every call in order", () =>
    Effect.gen(function* () {
      const fs = TestingFs.recordingFs(
        { "/data": "Directory", "/data/a.iso": "File" },
        { contents: { "/data/a.iso": new TextEncoder().encode("iso") } },
      );
      const [listing, text] = yield* Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        return [yield* files.readDirectory("/data"), yield* files.readFileString("/data/a.iso")];
      }).pipe(Effect.provide(fs.layer));
      expect(listing).toEqual(["a.iso"]);
      expect(text).toBe("iso");
      expect(TestingFs.methods(fs)).toEqual(["readDirectory", "readFileString"]);
    }),
  );
});

describe("recordingFs unhappy path", () => {
  it.effect("a path the table does not hold is Node's NotFound", () =>
    Effect.gen(function* () {
      const fs = TestingFs.recordingFs({});
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          return yield* files.stat("/nope");
        }).pipe(Effect.provide(fs.layer)),
      );
      expect(error).toMatchObject({ _tag: "PlatformError", reason: { _tag: "NotFound" } });
      expect(TestingFs.methods(fs)).toEqual(["stat"]);
    }),
  );
});

describe("intercepting", () => {
  it.effect("records a real write, and fails one to a path it was told to refuse", () =>
    Effect.gen(function* () {
      const intercepted = TestingFs.intercepting();
      yield* Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const dir = yield* files.makeTempDirectoryScoped();
        yield* files.writeFileString(`${dir}/ok.txt`, "ok");
        intercepted.failing.add(`${dir}/refused.txt`);
        const error = yield* Effect.flip(files.writeFileString(`${dir}/refused.txt`, "no"));
        expect(error).toMatchObject({ reason: { _tag: "PermissionDenied" } });
        expect(yield* files.exists(`${dir}/refused.txt`)).toBe(false);
      }).pipe(
        Effect.scoped,
        Effect.provide(intercepted.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      );
      expect(intercepted.calls.map((call) => call.method)).toEqual([
        "writeFileString",
        "writeFileString",
      ]);
    }),
  );
});
