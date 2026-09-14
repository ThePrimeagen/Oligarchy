import { describe, expect, it } from "vitest";
import { app, scheduled } from "../../src/dashboard/dashboard.tsx";

const SENTINEL_PASSWORD = "sentinel-secret-pw";

const env = {
  HYPERDRIVE: { connectionString: `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy` },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://automation.test",
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

describe("POST /abort happy path", () => {
  it("answers 200 with ok for a well-formed body that names no ticket", async () => {
    const response = await abort({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "true" });
  });
});

describe("POST /abort unhappy path", () => {
  it("answers 200 with ok when the ticket is empty", async () => {
    const response = await abort({ ticket: "" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "true" });
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
});

// The cron's failure is thrown, so Cloudflare records the event as failed and Sentry's wrapper
// reports it; the connection string never reaches the message.
describe("scheduled unhappy path", () => {
  it("rejects with the refused connection when the database is unreachable, without the password", async () => {
    const outcome = await scheduled({ cron: "0 4 * * *" }, env).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(outcome).toMatch(/ECONNREFUSED/);
    expect(outcome).not.toContain(SENTINEL_PASSWORD);
  });
});
