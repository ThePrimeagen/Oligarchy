import { describe, expect, it } from "vitest";
import type * as Logger from "../src/main.ts";
import * as Render from "../src/render.ts";

// The words a coloured line says, with its colour sequences taken out.
// oxlint-disable-next-line no-control-regex
const words = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");

describe("a log line", () => {
  it.each<[Logger.Level, string]>([
    ["info", "[INFO]"],
    ["warning", "[WARN]"],
    ["error", "[ERROR]"],
    ["fatal", "[FATAL]"],
  ])("a %s line opens with %s, then its agent, then the text (happy)", (level, label) => {
    expect(Render.renderLine({ text: "booted", level, agentId: "OLI-1" }, false)).toBe(
      `${label} [OLI-1] booted`,
    );
  });

  it("puts the location between the agent and the text (happy)", () => {
    const line = { text: "booted", level: "warning", agentId: "OLI-1", location: "s-1" } as const;

    expect(Render.renderLine(line, false)).toBe("[WARN] [OLI-1] s-1: booted");
  });

  it("a line with no agent and no location is global and says only its text (unhappy)", () => {
    expect(Render.renderLine({ text: "booted", level: "info" }, false)).toBe(
      "[INFO] [global] booted",
    );
  });

  it("says the same words with colours as without (happy)", () => {
    const line = { text: "booted", level: "error", agentId: "OLI-1", location: "s-1" } as const;
    const painted = Render.renderLine({ ...line, color: Render.ROSE_PINE_MAIN.iris }, true);

    expect(painted).not.toBe(Render.renderLine(line, false));
    expect(words(painted)).toBe(Render.renderLine(line, false));
  });
});
