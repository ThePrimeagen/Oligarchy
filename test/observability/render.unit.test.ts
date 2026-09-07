import { describe, expect, it } from "vitest";
import { Cause } from "effect";
import * as Render from "../../src/observability/render.ts";
import * as Errors from "../../src/shared/errors.ts";

const AGENT_ID = "OLI-61";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const LOVE = "#eb6f92";

describe("errorDetail", () => {
  it("reads an Error's message", () => {
    expect(Render.errorDetail(new Error("boom"))).toBe("boom");
  });

  it("reads a message-shaped object and a tagged error's getter", () => {
    expect(Render.errorDetail({ message: "boom" })).toBe("boom");
    expect(Render.errorDetail(Errors.MissingVariable.make({ name: "X" }))).toBe("X is not set");
  });

  it("stringifies anything else", () => {
    expect(Render.errorDetail("text")).toBe("text");
    expect(Render.errorDetail(42)).toBe("42");
    expect(Render.errorDetail(undefined)).toBe("undefined");
  });
});

describe("headline", () => {
  it("is the message alone without a cause", () => {
    expect(Render.headline(new Error("x"))).toBe("x");
    expect(Render.headline(Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" }))).toBe(
      "OLIGARCHY_TOKEN is not set",
    );
  });

  it("appends the cause's message", () => {
    const error = new Error("POST http://127.0.0.1:42069/send-keys failed", {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:42069"),
    });
    expect(Render.headline(error)).toBe(
      "POST http://127.0.0.1:42069/send-keys failed: connect ECONNREFUSED 127.0.0.1:42069",
    );
    expect(
      Render.headline(
        Errors.DatabaseError.make({
          operation: "ping",
          message: "Failed query: select 1",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:1"),
        }),
      ),
    ).toBe("Failed query: select 1: connect ECONNREFUSED 127.0.0.1:1");
  });

  it("ignores a cause without a message", () => {
    expect(Render.headline(new Error("x", { cause: 42 }))).toBe("x");
    expect(Render.headline("text")).toBe("text");
  });
});

describe("renderFailure", () => {
  it("is empty for an interrupt-only cause", () => {
    expect(Render.renderFailure(Cause.interrupt())).toBe("");
  });

  it("is the headline, then the pretty cause", () => {
    const cause = Cause.fail(new Error("boom", { cause: new Error("why") }));
    const rendered = Render.renderFailure(cause);
    const [first, ...rest] = rendered.split("\n");
    expect(first).toBe("boom: why");
    expect(rest.join("\n")).toBe(Cause.pretty(cause));
  });

  it("renders a defect", () => {
    const cause = Cause.die("oops");
    expect(Render.renderFailure(cause)).toBe(`oops\n${Cause.pretty(cause)}`);
  });
});

describe("renderLogLine", () => {
  it("colors only the ticket and renders the bare session id in gray", () => {
    expect(
      Render.renderLogLine(
        {
          text: "sent 9 chords in 1546ms",
          level: "info",
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          color: LOVE,
        },
        true,
      ),
    ).toBe(
      [
        "\x1b[37m[\x1b[39m",
        "\x1b[38;2;235;111;146mOLI-61\x1b[39m",
        "\x1b[37m] \x1b[39m",
        `\x1b[90m${SESSION_ID}\x1b[39m`,
        "\x1b[37m: sent 9 chords in 1546ms\x1b[39m",
      ].join(""),
    );
  });

  it("keeps an unattributed error readable without a ticket color or session", () => {
    expect(Render.renderLogLine({ text: "database unavailable", level: "error" }, true)).toBe(
      [
        "\x1b[37m[\x1b[39m",
        "\x1b[90mglobal\x1b[39m",
        "\x1b[37m] error: database unavailable\x1b[39m",
      ].join(""),
    );
  });

  it("paints an agent without a colour gray", () => {
    expect(Render.renderLogLine({ text: "hello", level: "warning", agentId: AGENT_ID }, true)).toBe(
      ["\x1b[37m[\x1b[39m", "\x1b[90mOLI-61\x1b[39m", "\x1b[37m] warning: hello\x1b[39m"].join(""),
    );
  });

  it("writes plain text without colours", () => {
    expect(
      Render.renderLogLine(
        {
          text: "sent 9 chords in 1546ms",
          level: "info",
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          color: LOVE,
        },
        false,
      ),
    ).toBe(`[OLI-61] ${SESSION_ID}: sent 9 chords in 1546ms`);
    expect(Render.renderLogLine({ text: "proxy: boom", level: "fatal" }, false)).toBe(
      "[global] fatal: proxy: boom",
    );
    expect(Render.renderLogLine({ text: "listening", level: "info" }, false)).toBe(
      "[global] listening",
    );
  });
});

describe("paint and AGENT_COLORS", () => {
  it("emits 24-bit SGR only when colours are on", () => {
    expect(Render.paint(LOVE, "x", true)).toBe("\x1b[38;2;235;111;146mx\x1b[39m");
    expect(Render.paint(LOVE, "x", false)).toBe("x");
  });

  it("starts the palette with Rose Pine love", () => {
    expect(Render.AGENT_COLORS[0]).toBe(LOVE);
    expect(Render.AGENT_COLORS).toHaveLength(10);
    expect(new Set(Render.AGENT_COLORS).size).toBe(10);
  });
});

describe("wantsColor", () => {
  it("is false without a TTY and without FORCE_COLOR", () => {
    expect(Render.wantsColor({ isTTY: false, hasColors: () => true }, {})).toBe(false);
    expect(Render.wantsColor({}, {})).toBe(false);
  });

  it("is true with FORCE_COLOR=1 when 16 colours are supported", () => {
    expect(
      Render.wantsColor({ isTTY: false, hasColors: (n) => n <= 16 }, { FORCE_COLOR: "1" }),
    ).toBe(true);
  });

  it("is true on a TTY that supports 16 colours", () => {
    expect(Render.wantsColor({ isTTY: true, hasColors: (n) => n <= 16 }, {})).toBe(true);
  });

  it("is false when the stream cannot render 16 colours", () => {
    expect(Render.wantsColor({ isTTY: true, hasColors: () => false }, { FORCE_COLOR: "1" })).toBe(
      false,
    );
  });

  it("falls back to Node's colour detection when the stream has no hasColors", () => {
    expect(Render.wantsColor({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(Render.wantsColor({ isTTY: false }, { FORCE_COLOR: "0" })).toBe(false);
  });
});
