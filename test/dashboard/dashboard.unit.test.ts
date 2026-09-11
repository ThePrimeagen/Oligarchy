import { describe, expect, it } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";

const env = {
  HYPERDRIVE: { connectionString: "postgres://user:x@127.0.0.1:1/oligarchy" },
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
});
