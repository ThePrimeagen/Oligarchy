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

describe("test results page unhappy path", () => {
  it("answers /results with the test results page when the database cannot be read", async () => {
    const response = await app.request("/results", undefined, env);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Sessions are unavailable.");
    expect(html).toContain("Test results");
    expect(html).toContain('href="/results"');
  });
});

describe("homepage unhappy path", () => {
  it("answers / as the servers page when the database cannot be read, with the definitions tab", async () => {
    const response = await app.request("/", undefined, env);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>oligarchy servers</title>");
    expect(html).toContain("<h1>oligarchy servers</h1>");
    expect(html).toContain(
      '<nav class="tabs" aria-label="Pages"><a href="/" aria-current="page">servers</a><a href="/definitions">definitions</a></nav>',
    );
    expect(html).toContain("<p>error: internal error</p>");
    expect(html).not.toContain("dashboard.css");
    expect(html).not.toContain("Test results");
    expect(html).not.toContain("postgres://");
  });

  it("answers /servers the same way", async () => {
    const response = await app.request("/servers", undefined, env);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<h1>oligarchy servers</h1>");
    expect(html).toContain('aria-current="page">servers</a>');
  });

  it("answers /definitions as the same plain document when the database cannot be read", async () => {
    const response = await app.request("/definitions", undefined, env);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>oligarchy definitions</title>");
    expect(html).toContain("<h1>oligarchy definitions</h1>");
    expect(html).toContain(
      '<nav class="tabs" aria-label="Pages"><a href="/">servers</a><a href="/definitions" aria-current="page">definitions</a></nav>',
    );
    expect(html).toContain("<p>error: Test definitions are unavailable.</p>");
    expect(html).not.toContain('id="running-tests"');
    expect(html).not.toContain("No tests are running.");
    expect(html).not.toContain("dashboard.css");
    expect(html).not.toContain('href="/definitions?name=');
    expect(html).not.toContain("postgres://");
    expect(html).not.toContain("OMARCHY");
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
  it("answers a definition's page as the definitions document when the database cannot be read", async () => {
    const response = await app.request("/definitions/lock-screen", undefined, env);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<title>oligarchy definitions</title>");
    expect(html).toContain("<p>error: Test definitions are unavailable.</p>");
    expect(html).toContain('href="/definitions" aria-current="page"');
    expect(html).not.toContain("<h1>oligarchy servers</h1>");
    expect(html).not.toContain("No test definition named");
    expect(html).not.toContain("postgres://");
  });

  it("keeps /definitions/running a fragment, not a definition named running", async () => {
    const response = await app.request("/definitions/running", undefined, env);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("<p>error: internal error</p>");
  });

  it("keeps /definitions/histories a fragment, not a definition named histories", async () => {
    const response = await app.request("/definitions/histories?name=lock-screen", undefined, env);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("<p>error: internal error</p>");
  });

  it("does not open a definition page for a histories refresh that names nothing", async () => {
    const response = await app.request("/definitions/histories", undefined, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("test diagnostic page unhappy path", () => {
  it("does not look up an id that is not a result id", async () => {
    const response = await app.request("/tests/not-a-uuid", undefined, env);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("<p>No test result.</p>");
    expect(html).not.toContain("postgres://");
    expect(html).not.toContain("not-a-uuid");
  });

  it("says the test result is unavailable when the database cannot be read", async () => {
    const response = await app.request(
      "/tests/11111111-1111-4111-8111-111111111111",
      undefined,
      env,
    );
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<p>error: The test result is unavailable.</p>");
    expect(html).toContain('href="/definitions" aria-current="page"');
    expect(html).not.toContain("postgres://");
  });
});
