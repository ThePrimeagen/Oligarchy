import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import * as Actions from "../../src/client/actions.ts";
import * as Support from "../support/config.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as Stdio from "../support/stdio.ts";

const TOKEN = "test-token";
const SESSION = "session-1";

const run = (args: ReadonlyArray<string>, http: Layer.Layer<HttpClient.HttpClient>) =>
  Actions.call(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        http,
        Support.withEnv({ OLIGARCHY_TOKEN: TOKEN }),
        NodeFileSystem.layer,
        NodePath.layer,
        Stdio.capture().layer,
      ),
    ),
  );

describe("client actions", () => {
  it("mouse click is the function the name looks up", () => {
    expect(Actions.byName["mouse click"]).toBe(Actions.mouseClick);
  });

  it.effect("call finds mouse click and posts that gesture", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* run(
        [
          "mouse",
          "click",
          "--agent-id",
          "OLI-1",
          "--server-url",
          "http://127.0.0.1:9",
          "--session-id",
          SESSION,
          "--x",
          "0.25",
          "--y",
          "0.5",
        ],
        recorder.layer,
      );
      expect(recorder.requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/mouse/click",
      ]);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({
        id: SESSION,
        x: 0.25,
        y: 0.5,
        button: "left",
        agent: "OLI-1",
      });
    }),
  );

  it.effect("an unknown action and an unknown flag send nothing (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      const unknown = yield* Effect.flip(
        run(["mouse", "poke", "--agent-id", "OLI-1"], recorder.layer),
      );
      expect(unknown._tag).toBe("CommandError");
      if (unknown._tag === "CommandError") {
        expect(unknown.message).toContain("mouse poke");
      }
      const flag = yield* Effect.flip(run(["start", "--nope"], recorder.layer));
      expect(flag._tag).toBe("CommandError");
      if (flag._tag === "CommandError") {
        expect(flag.message).toContain("--nope");
      }
      expect(recorder.requests).toEqual([]);
    }),
  );
});
