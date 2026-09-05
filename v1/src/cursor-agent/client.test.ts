import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { prompt } from "./client.ts";

const RUN_ID = "run-22222222-2222-4222-8222-222222222222";
const AGENT_ID_PATTERN = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => mock.restoreAll());

type CursorRequest = {
  method: string;
  url: string;
  headers: Headers;
  body?: unknown;
};

function cursorApi(requests: CursorRequest[]) {
  return async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
    const request: CursorRequest = {
      method: init?.method ?? "GET",
      url: input as string,
      headers: new Headers(init?.headers),
    };
    if (typeof init?.body === "string") {
      request.body = JSON.parse(init.body) as unknown;
    }
    requests.push(request);

    if (request.method === "GET" && request.url.endsWith("/v1/models")) {
      return Response.json({
        items: [
          { id: "grok-4.6", displayName: "Cursor Grok 4.6" },
          { id: "composer-2.5", displayName: "Composer 2.5" },
        ],
      });
    }
    if (request.method === "POST" && request.url.endsWith("/v1/agents")) {
      const { agentId } = request.body as { agentId: string };
      const now = new Date().toISOString();
      return Response.json({
        agent: {
          id: agentId,
          status: "ACTIVE",
          url: `https://cursor.com/agents/${agentId}`,
          createdAt: now,
          updatedAt: now,
          latestRunId: RUN_ID,
        },
        run: { id: RUN_ID, agentId, status: "CREATING", createdAt: now, updatedAt: now },
      });
    }
    return Response.json({ error: { code: "not_found", message: "not found" } }, { status: 404 });
  };
}

function createdAgent(requests: CursorRequest[]) {
  const created = requests.filter((request) => request.method === "POST" && request.url.endsWith("/v1/agents"));
  assert.equal(created.length, 1);
  return created[0];
}

describe("prompt happy path", () => {
  it("kicks off a cloud agent on the repository with Grok 4.6 fast, extra high, and prints its link", async () => {
    const requests: CursorRequest[] = [];
    mock.method(globalThis, "fetch", cursorApi(requests));
    const log = mock.method(console, "log", () => undefined);

    await prompt("test-token", "Review Linear ticket OLI-42 and complete your task.");

    const created = createdAgent(requests);
    assert.equal(created.url, "https://api.cursor.com/v1/agents");
    assert.equal(created.headers.get("Authorization"), "Bearer test-token");
    const body = created.body as {
      agentId: string;
      prompt: { text: string };
      model: unknown;
      repos: unknown;
    };
    assert.match(body.agentId, AGENT_ID_PATTERN);
    assert.deepEqual(body.prompt, { text: "Review Linear ticket OLI-42 and complete your task." });
    assert.deepEqual(body.model, {
      id: "grok-4.6",
      params: [
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "true" },
      ],
    });
    assert.deepEqual(body.repos, [{ url: "https://github.com/ThePrimeagen/Oligarchy" }]);
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(log.mock.calls[0].arguments, [
      `Agent here, go check it out for more information: https://cursor.com/agents/${body.agentId}`,
    ]);
  });

  it("sends the model given in the options instead of the default", async () => {
    const requests: CursorRequest[] = [];
    mock.method(globalThis, "fetch", cursorApi(requests));
    mock.method(console, "log", () => undefined);

    await prompt("test-token", "hello", { model: { id: "composer-2.5" } });

    const body = createdAgent(requests).body as { model: unknown };
    assert.deepEqual(body.model, { id: "composer-2.5" });
  });
});

describe("prompt unhappy path", () => {
  it("rejects when Cursor refuses the token and prints nothing", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { code: "unauthorized", message: "Invalid API key" } }, { status: 401 }),
    );
    const log = mock.method(console, "log", () => undefined);

    await assert.rejects(() => prompt("bad-token", "hello"), { message: "Invalid API key" });
    assert.equal(log.mock.callCount(), 0);
  });

  it("rejects a model Cursor does not offer before creating an agent", async () => {
    const requests: CursorRequest[] = [];
    mock.method(globalThis, "fetch", cursorApi(requests));
    const log = mock.method(console, "log", () => undefined);

    await assert.rejects(() => prompt("test-token", "hello", { model: { id: "grok-9" } }), {
      message: /Model 'grok-9' is not available or invalid/,
    });
    assert.equal(requests.some((request) => request.method === "POST" && request.url.endsWith("/v1/agents")), false);
    assert.equal(log.mock.callCount(), 0);
  });
});
