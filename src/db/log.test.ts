import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Db } from "./ops.ts";
import {
  acquireAgentColor,
  flushLogs,
  log,
  releaseAgentColor,
} from "./log.ts";

const AGENT_ID = "OLI-61";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const db = {
  insert: () => ({
    values: async () => undefined,
  }),
} as unknown as Db;

let output: string[];
let originalConsoleLog: typeof console.log;
let originalForceColor: string | undefined;

beforeEach(() => {
  output = [];
  originalConsoleLog = console.log;
  originalForceColor = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1";
  console.log = (...values: unknown[]) => {
    output.push(values.join(" "));
  };
});

afterEach(() => {
  console.log = originalConsoleLog;
  if (originalForceColor === undefined) {
    delete process.env.FORCE_COLOR;
  } else {
    process.env.FORCE_COLOR = originalForceColor;
  }
  releaseAgentColor(AGENT_ID);
});

describe("log output", () => {
  it("colors only the ticket and renders the bare session id in gray", async () => {
    acquireAgentColor(AGENT_ID);

    log(db, {
      text: `session ${SESSION_ID}: sent 9 chords in 1546ms`,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
    });
    await flushLogs();

    assert.deepEqual(output, [
      "\x1b[37m[\x1b[39m" +
        "\x1b[38;2;235;111;146mOLI-61\x1b[39m" +
        "\x1b[37m] \x1b[39m" +
        `\x1b[90m${SESSION_ID}\x1b[39m` +
        "\x1b[37m: sent 9 chords in 1546ms\x1b[39m",
    ]);
  });

  it("keeps an unattributed error readable without a ticket color or session", async () => {
    log(db, { level: "error", text: "database unavailable" });
    await flushLogs();

    assert.deepEqual(output, [
      "\x1b[37m[\x1b[39m" +
        "\x1b[90mglobal\x1b[39m" +
        "\x1b[37m] error: database unavailable\x1b[39m",
    ]);
  });
});
