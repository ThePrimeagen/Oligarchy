import { describe, expect, it } from "vitest";
import * as DebugLogs from "../../src/db/debug-logs.ts";

describe("formatProxyLogs", () => {
  it("joins each row as time, level and text", () => {
    expect(
      DebugLogs.formatProxyLogs([
        {
          level: "info",
          text: "running; started in 12ms",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          level: "error",
          text: "GET /image failed: qemu: closed",
          createdAt: new Date("2026-01-01T00:00:01.500Z"),
        },
      ]),
    ).toBe(
      [
        "2026-01-01T00:00:00.000Z info running; started in 12ms",
        "2026-01-01T00:00:01.500Z error GET /image failed: qemu: closed",
      ].join("\n"),
    );
  });

  it("an empty list is an empty snapshot", () => {
    expect(DebugLogs.formatProxyLogs([])).toBe("");
  });
});

describe("truncateDebugText", () => {
  it("leaves a short string alone", () => {
    expect(DebugLogs.truncateDebugText("journal")).toBe("journal");
    expect(DebugLogs.truncateDebugText("x".repeat(DebugLogs.MAX_DEBUG_TEXT))).toBe(
      "x".repeat(DebugLogs.MAX_DEBUG_TEXT),
    );
  });

  it("cuts a long string at the cap and marks the cut", () => {
    const text = "y".repeat(DebugLogs.MAX_DEBUG_TEXT + 20);
    expect(DebugLogs.truncateDebugText(text)).toBe(
      `${"y".repeat(DebugLogs.MAX_DEBUG_TEXT)}\n[truncated]`,
    );
  });
});
