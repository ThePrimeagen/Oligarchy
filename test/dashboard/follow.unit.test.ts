import { describe, expect, it } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";

const env = {
  HYPERDRIVE: { connectionString: "postgres://user:sentinel-secret-pw@127.0.0.1:1/oligarchy" },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
  LINEAR_API_URL: "http://127.0.0.1:1",
  LINEAR_API_TOKEN: "lin_api_x",
  LINEAR_TEAM: "Local Board",
};

describe("GET /tickets unhappy path", () => {
  it("refuses a ticket id that is not a path segment, and does not ask the database", async () => {
    const page = await app.request("/tickets/has.dot", undefined, env);
    const feed = await app.request("/tickets/has.dot/feed", undefined, env);
    expect(page.status).toBe(404);
    expect(feed.status).toBe(404);
    expect(await page.text()).not.toContain("sentinel-secret-pw");
    expect(await feed.text()).not.toContain("sentinel-secret-pw");
  });

  it("fails when the database cannot be reached, and never echoes the password", async () => {
    const page = await app.request("/tickets/OLI-1", undefined, env);
    const feed = await app.request("/tickets/OLI-1/feed", undefined, env);
    expect(page.status).toBe(500);
    expect(feed.status).toBe(500);
    expect(await page.text()).not.toContain("sentinel-secret-pw");
    expect(await feed.text()).not.toContain("sentinel-secret-pw");
  });
});
