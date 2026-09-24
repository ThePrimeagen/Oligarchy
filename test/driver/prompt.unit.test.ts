import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import * as Prompts from "../../src/automation-server/prompts.ts";

describe("openrouter-driving-agent.html", () => {
  it.effect("fills the thin client guide and leaves no placeholder", () =>
    Effect.gen(function* () {
      const text = yield* Prompts.openRouterDrive(
        "Lock the screen.",
        "The lock screen is showing.",
        ['say "hi"'],
        2,
      ).pipe(Effect.provide(NodeFileSystem.layer));
      expect(text.includes("{{")).toBe(false);
      expect(text).toContain("Lock the screen.");
      expect(text).toContain("The lock screen is showing.");
      expect(text).toContain("This is step 2.");
      expect(text).toContain(JSON.stringify(['say "hi"']));
      expect(text).toContain("completes is true");
      expect(text).toContain("reason is why");
      expect(text).toContain("When completes is true the action is not run");
      expect(text).toContain("100 milliseconds");
      expect(text).toContain("wait");
      expect(text).toContain("fractions of the screenshot");
      expect(text).toContain("from 0 to 1");
      expect(text).toContain("send-keys");
      expect(text).toContain("<ENTER>");
      expect(text).toContain("<LT>");
      expect(text).toContain("`left`, `middle`, or `right`");
      expect(text).toContain("`shift`, `ctrl`, `alt`, `super`");
      expect(text).toContain("`up`, `down`, `left`, or `right`");
      expect(text).not.toContain("RESULT_ID");
      expect(text).not.toContain("--agent-id");
      expect(text).not.toContain("--session-id");
      expect(text).not.toContain("--server-url");
      expect(text).not.toContain("{{CLIENT_TOOLS}}");
    }),
  );
});
