import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as Linear from "../../src/ctrl/linear.ts";
import * as Prompts from "../../src/ctrl/prompts.ts";
import { app } from "../../src/dashboard/dashboard.tsx";
import { renderSuiteTicket, SUITE_LINEAR } from "../../src/dashboard/suite.ts";

const SENTINEL_PASSWORD = "sentinel-secret-pw";
const REQUIRED = "iso, version and serverUrl are required";

const env = {
  HYPERDRIVE: {
    connectionString: `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy`,
  },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
  LINEAR_API_URL: "http://127.0.0.1:1/graphql",
  LINEAR_API_TOKEN: "lin_api_x",
};

const ISO = "https://example.com/omarchy.iso";
const SERVER = "http://qemu.example:42069";

const post = (body: string) =>
  app.request(
    "/run-test-suite",
    { method: "POST", headers: { "content-type": "application/json" }, body },
    env,
  );

const ticket = {
  LINEAR_TICKET: "OLI-42",
  RUN_ID: "11111111-1111-4111-8111-111111111111",
  RESULT_ID: "22222222-2222-4222-8222-222222222222",
  VERSION: "1.2.3",
  ISO_URL: ISO,
  SERVER_URL: SERVER,
  TEST_NAME: "suite-alpha",
  TEST_DESCRIPTION: "what the test is",
  TEST_INSTRUCTION: "new-alpha",
  TEST_PROOF: "the screen shows it",
};

describe("POST /run-test-suite unhappy path", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    error.mockClear();
  });

  afterAll(() => {
    error.mockRestore();
  });

  it("refuses a body that is not JSON, without logging", async () => {
    const response = await post("not-json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: REQUIRED });
    expect(error).not.toHaveBeenCalled();
  });

  it("refuses a body missing a field, an empty version, an http iso and a non-http server", async () => {
    const missing = await post(JSON.stringify({ iso: ISO }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: REQUIRED });

    const emptyVersion = await post(JSON.stringify({ iso: ISO, version: "", serverUrl: SERVER }));
    expect(emptyVersion.status).toBe(400);
    expect(await emptyVersion.json()).toEqual({ error: REQUIRED });

    const httpIso = await post(
      JSON.stringify({
        iso: "http://example.com/omarchy.iso",
        version: "1.2.3",
        serverUrl: SERVER,
      }),
    );
    expect(httpIso.status).toBe(400);
    expect(await httpIso.json()).toEqual({ error: "iso must be a valid https url" });

    const ftp = await post(
      JSON.stringify({ iso: ISO, version: "1.2.3", serverUrl: "ftp://qemu.example" }),
    );
    expect(ftp.status).toBe(400);
    expect(await ftp.json()).toEqual({ error: "serverUrl must be a valid http or https url" });
    expect(error).not.toHaveBeenCalled();
  });
});

describe("POST /run-test-suite unhappy path: unreachable database", () => {
  it("answers 500 without the database password, and does not call Linear", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post(
        JSON.stringify({ iso: ISO, version: "1.2.3", serverUrl: SERVER }),
      );
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).not.toContain(SENTINEL_PASSWORD);
      expect(text).not.toContain("linear:");
      expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
        SENTINEL_PASSWORD,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      error.mockRestore();
    }
  });
});

describe("suite ticket text", () => {
  it("matches the text ./ctrl renders for the same values", async () => {
    const fromCtrl = await Effect.runPromise(
      Prompts.renderLinearIssue(ticket).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(renderSuiteTicket(ticket)).toBe(fromCtrl);
  });

  it("names the same team, label, assignee and states as ./ctrl", () => {
    expect(SUITE_LINEAR).toEqual({
      team: Linear.LINEAR_TEAM,
      agentTestLabel: Linear.AGENT_TEST_LABEL,
      assigneeEmail: Linear.ASSIGNEE_EMAIL,
      backlogState: Linear.BACKLOG_STATE,
      automationNeededState: Linear.AUTOMATION_NEEDED_STATE,
    });
  });
});
