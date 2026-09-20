import { describe, expect, it } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";

// Nothing here names a ticket, so no server, database or Linear is reached: every url refuses.
const env = {
  HYPERDRIVE: { connectionString: "postgres://user:x@127.0.0.1:1/oligarchy" },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
  LINEAR_API_URL: "http://127.0.0.1:1",
  LINEAR_API_TOKEN: "lin_api_x",
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
    expect(response.headers.get("location")).toBe("/definitions?name=lock-screen");
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

  it("sends a definitions-page abort whose definition is empty back to that empty name", async () => {
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
    expect(response.headers.get("location")).toBe("/definitions?name=");
  });
});
