import { describe, expect, it } from "vitest";
import { app } from "../src/dashboard.tsx";

// Nothing here names a ticket, so no server, database or Linear is reached: every url refuses.
const env = {
  HYPERDRIVE: { connectionString: "postgres://user:x@127.0.0.1:1/oligarchy" },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
  LINEAR_API_URL: "http://127.0.0.1:1",
  LINEAR_API_TOKEN: "lin_api_x",
  LINEAR_TEAM: "Local Board",
};

const abort = (body: string | Record<string, unknown>) =>
  app.request(
    "/abort",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

const SENTINEL_PASSWORD = "sentinel-secret-pw";

const abortSuite = (run: string, headers: Record<string, string> = {}) =>
  app.request(
    "/suites/abort",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({ run }).toString(),
    },
    {
      ...env,
      HYPERDRIVE: {
        connectionString: `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy`,
      },
    },
  );

describe("POST /suites/abort happy path", () => {
  it("sends a form that names no suite back to the servers page", async () => {
    const response = await abortSuite("");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/servers");
  });
});

describe("POST /suites/abort unhappy path", () => {
  it("sends a form whose run id is not a uuid back to the servers page", async () => {
    const response = await abortSuite("not-a-suite");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/servers");
    expect(await response.text()).not.toContain(SENTINEL_PASSWORD);
  });

  it("answers when the database cannot be read, and does not echo the password", async () => {
    const response = await abortSuite("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", {
      "hx-request": "true",
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(SENTINEL_PASSWORD);
    expect(body).not.toContain("postgres://");
  });
});

describe("POST /abort happy path", () => {
  it("answers 200 with ok for a well-formed body that names no ticket", async () => {
    const response = await abort({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "true" });
  });
});

describe("pages unhappy path", () => {
  it("fails every page when the database cannot be read, and does not echo the connection", async () => {
    for (const path of ["/results", "/", "/servers", "/definitions"]) {
      const response = await app.request(path, undefined, env);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("postgres://");
    }
  });
});

describe("POST /abort unhappy path", () => {
  it("answers 200 with ok when the ticket is empty", async () => {
    const response = await abort({ ticket: "", action: "drive" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "true" });
  });

  it("answers 200 with ok when the action is missing or not one a job has", async () => {
    const missing = await abort({ ticket: "OLI-61" });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ ok: "true" });
    const unknown = await abort({ ticket: "OLI-61", action: "reboot" });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: "true" });
  });

  it("answers 200 with ok when the body is not JSON", async () => {
    const response = await abort("not-json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "true" });
  });

  it("sends a form post without a ticket back to the servers page", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      },
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/servers");
  });

  it("sends a definitions-page abort that names no ticket back to that definition", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          view: "definitions",
          definition: "lock-screen",
        }).toString(),
      },
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/definitions/lock-screen");
  });

  it("sends a definitions-page abort with no definition back to the definitions page", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ view: "definitions" }).toString(),
      },
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/definitions");
  });

  it("sends a definitions-page abort whose definition is empty back to the definitions index", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ view: "definitions", definition: "" }).toString(),
      },
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/definitions");
  });
});

describe("definition pages happy path", () => {
  it("sends an old ?name link to that definition's page", async () => {
    const response = await app.request("/definitions?name=lock-screen", undefined, env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/definitions/lock-screen");
  });

  it("keeps an edit notice on the definition's page", async () => {
    const response = await app.request(
      "/definitions?name=wide%20layout&edit=unchanged",
      undefined,
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/definitions/wide%20layout?edit=unchanged");
  });

  it("sends an empty ?name back to the definitions index", async () => {
    const response = await app.request("/definitions?name=", undefined, env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/definitions");
  });
});

describe("definition pages unhappy path", () => {
  it("fails a definition's page when the database cannot be read, and does not echo the connection", async () => {
    const response = await app.request("/definitions/lock-screen", undefined, env);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("postgres://");
  });

  it("does not open a definition page for a histories refresh that names nothing", async () => {
    const response = await app.request("/definitions/histories", undefined, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("test diagnostic page unhappy path", () => {
  it("does not look up an id that is not a result id", async () => {
    for (const path of ["/tests/not-a-uuid", "/test-results/not-a-uuid"]) {
      const response = await app.request(path, undefined, env);
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toContain("postgres://");
      expect(body).not.toContain("not-a-uuid");
    }
  });

  it("fails when the database cannot be read, and does not echo the connection", async () => {
    const response = await app.request(
      "/tests/11111111-1111-4111-8111-111111111111",
      undefined,
      env,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("postgres://");
  });
});
