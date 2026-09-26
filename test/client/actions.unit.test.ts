import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as Config from "@oligarchy/env/config";
import * as TestingHttp from "@oligarchy/testing/http-client";
import * as Actions from "../../src/client/actions.ts";
import * as Stdio from "../support/stdio.ts";

const TOKEN = "test-token";
const SESSION = "session-1";
const ISO = "https://example.com/omarchy.iso";

const run = (args: ReadonlyArray<string>, http: Layer.Layer<HttpClient.HttpClient>) =>
  Actions.call(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        http,
        Config.fromValues({ OLIGARCHY_TOKEN: TOKEN }),
        NodeFileSystem.layer,
        NodePath.layer,
        Stdio.capture().layer,
      ),
    ),
  );

const messageOf = (error: { readonly _tag: string; readonly message?: string }): string => {
  expect(error._tag).toBe("CommandError");
  return error.message ?? "";
};

describe("client actions", () => {
  it("mouse click is the function the name looks up", () => {
    expect(Actions.byName["mouse click"]).toBe(Actions.mouseClick);
  });

  it.effect("call finds mouse click and posts that gesture", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
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
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
      const unknown = yield* Effect.flip(
        run(["mouse", "poke", "--agent-id", "OLI-1"], recorder.layer),
      );
      expect(messageOf(unknown)).toContain("mouse poke");
      const flag = yield* Effect.flip(run(["start", "--nope"], recorder.layer));
      expect(messageOf(flag)).toContain("--nope");
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect("call parses flags the same way the client command does", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests((request) =>
        new URL(request.url).pathname === "/start"
          ? TestingHttp.json({ id: SESSION })
          : TestingHttp.json({ ok: "true" }),
      );
      const shared = ["--agent-id", "OLI-1", "--server-url", "http://127.0.0.1:9"] as const;
      yield* run(["start", ...shared, "--iso", ISO, "--resume", "yes"], recorder.layer);
      yield* run(["start", ...shared, "--iso", ISO, "--no-resume"], recorder.layer);
      yield* run(["send-keys", ...shared, "--session-id", SESSION, "--keys="], recorder.layer);
      yield* run(["relinquish", ...shared, "--env-file", ".prod-env"], recorder.layer);
      expect(recorder.requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/start",
        "/start",
        "/send-keys",
        "/relinquish",
      ]);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({
        iso: ISO,
        agent: "OLI-1",
        mode: "resume",
      });
      expect(JSON.parse(recorder.requests[1]?.body ?? "")).toEqual({ iso: ISO, agent: "OLI-1" });
      expect(JSON.parse(recorder.requests[2]?.body ?? "")).toEqual({
        id: SESSION,
        keys: "",
        encoding: "oligarchy",
        agent: "OLI-1",
      });
    }),
  );

  it.effect("a flag the client command would refuse sends nothing (unhappy)", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
      const shared = ["--agent-id", "OLI-1", "--server-url", "http://127.0.0.1:9"] as const;
      const resume = yield* Effect.flip(
        run(["start", ...shared, "--iso", ISO, "--resume=garbage"], recorder.layer),
      );
      expect(messageOf(resume)).toContain("--resume");
      const dashed = yield* Effect.flip(
        run(["start", "-agent-id", "OLI-1", "--iso", ISO], recorder.layer),
      );
      expect(messageOf(dashed)).toContain("-a");
      const modifiers = yield* Effect.flip(
        run(
          [
            "mouse",
            "click",
            ...shared,
            "--session-id",
            SESSION,
            "--x",
            "0.25",
            "--y",
            "0.5",
            "--modifier",
            "shift",
            "--modifier",
            "ctrl",
            "--modifier",
            "alt",
            "--modifier",
            "super",
            "--modifier",
            "shift",
          ],
          recorder.layer,
        ),
      );
      expect(messageOf(modifiers)).toContain("at most 4");
      const range = yield* Effect.flip(
        run(
          ["mouse", "click", ...shared, "--session-id", SESSION, "--x", "2", "--y", "0.5"],
          recorder.layer,
        ),
      );
      expect(messageOf(range)).toContain("0..1");
      const envFile = yield* Effect.flip(
        run(["relinquish", ...shared, "--env-file"], recorder.layer),
      );
      expect(messageOf(envFile)).toContain("--env-file");
      expect(recorder.requests).toEqual([]);
    }),
  );
});
