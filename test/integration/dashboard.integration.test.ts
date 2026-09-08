import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";
import { sessions, testDefinitions, testResults, testRuns } from "../../src/db/schema.ts";

const QUERY = fileURLToPath(new URL("../../src/dashboard/query.ts", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../src/db/schema.ts", import.meta.url));
const SENTINEL_PASSWORD = "sentinel-secret-pw";
const REFUSED_URL = `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy`;
const SEEDED_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EXIT_WITHIN_MS = 15_000;

const dbUrl = inject("dbUrl");

type QueryRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly hung: boolean;
};

// Each call runs in its own process and the script never calls process.exit: a pg client
// that is not ended keeps the event loop alive, so the process exiting on its own is the
// proof that end() ran, on success and on failure alike.
const runQuery = (script: string, databaseUrl: string): Promise<QueryRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        `import * as query from ${JSON.stringify(QUERY)};\nconst url = process.env.DATABASE_URL;\n${script}`,
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.on("data", (data: string) => {
      stderr += data;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), EXIT_WITHIN_MS);
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, hung: signal === "SIGKILL" });
    });
  });

const lines = (output: string): ReadonlyArray<string> =>
  output.split("\n").filter((line) => line !== "");

describe.skipIf(dbUrl === "")("dashboard/query happy path", () => {
  it("lists test definitions and ends the connection so the process exits on its own", async () => {
    const result = await runQuery(
      "const rows = await query.listTestDefinitions(url);\nconsole.log(rows.map((row) => row.name).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toContain("lock-screen");
  });

  it("lists sessions with their latest image id and ends the connection", async () => {
    const result = await runQuery(
      "const rows = await query.listSessions(url);\nconsole.log(rows.map((row) => [row.id, typeof row.status, row.imageId === null ? 'null' : typeof row.imageId, row.queriedAt instanceof Date, row.definitionName === null ? 'null' : row.definitionName, row.definitionVersion === null ? 'null' : typeof row.definitionVersion, row.model === null ? 'null' : row.model].join(' ')).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows = lines(result.stdout);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
    for (const row of rows) {
      expect(row).toMatch(/^[0-9a-f-]{36} string (null|string) true \S+ (null|number) \S+$/);
    }
    expect(rows.some((row) => row.startsWith(`${SEEDED_SESSION_ID} `))).toBe(true);
  });

  it("joins each session to its result's definition, version and model, including two models on one run (happy)", async () => {
    const result = await runQuery(
      `
const { drizzle } = await import("drizzle-orm/node-postgres");
const { Client } = await import("pg");
const schema = await import(${JSON.stringify(SCHEMA)});
const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);
// Two wordings of one name: the session that ran the second is labelled v2, not v1.
await db.insert(schema.testDefinitions).values({ name: "lock-sessions", description: "d", instruction: "first", proof: "p" });
const [lockV2] = await db.insert(schema.testDefinitions).values({ name: "lock-sessions", description: "d", instruction: "second", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [install] = await db.insert(schema.testDefinitions).values({ name: "install", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [run] = await db.insert(schema.testRuns).values({ name: "Omarchy experiment", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id });
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: lockV2.id, sessionId: ${JSON.stringify(SEEDED_SESSION_ID)}, status: "passed", model: "grok-4.6" },
  { runId: run.id, definitionId: install.id, sessionId: "22222222-2222-4222-8222-222222222222", status: "failed", model: "composer-2.5" },
]);
await client.end();
const rows = await query.listSessions(url);
const lockRow = rows.find((row) => row.id === ${JSON.stringify(SEEDED_SESSION_ID)});
const installRow = rows.find((row) => row.id === "22222222-2222-4222-8222-222222222222");
console.log([lockRow?.definitionName, lockRow?.definitionVersion, lockRow?.model, installRow?.definitionName, installRow?.definitionVersion, installRow?.model].join(" "));
console.log(JSON.stringify(query.definitionStats(rows).filter((row) => row.name === "install" || row.name === "lock-sessions")));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const [linked, stats] = lines(result.stdout);
    expect(linked).toBe("lock-sessions 2 grok-4.6 install 1 composer-2.5");
    expect(JSON.parse(stats ?? "")).toEqual([
      { name: "install", succeeded: 0, failed: 0, other: 1, models: ["composer-2.5"] },
      { name: "lock-sessions", succeeded: 1, failed: 0, other: 0, models: ["grok-4.6"] },
    ]);
  });

  it("lists test result outcomes with the wording's id, the model and the run, and ends the connection", async () => {
    const result = await runQuery(
      `
const { drizzle } = await import("drizzle-orm/node-postgres");
const { Client } = await import("pg");
const schema = await import(${JSON.stringify(SCHEMA)});
const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);
const [lock] = await db.insert(schema.testDefinitions).values({ name: "lock-outcomes", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [install] = await db.insert(schema.testDefinitions).values({ name: "install-outcomes", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [run] = await db.insert(schema.testRuns).values({ name: "Omarchy experiment", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id, startedAt: schema.testRuns.startedAt });
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: lock.id, status: "passed", model: "grok-4.6" },
  { runId: run.id, definitionId: install.id, status: "failed", model: "composer-2.5" },
]);
await client.end();
const rows = await query.listTestResultOutcomes(url);
const ours = rows.filter((row) => row.definitionId === lock.id || row.definitionId === install.id);
const counted = query.modelStats(ours);
console.log(ours.map((row) => [row.definitionId === lock.id ? "lock" : "install", row.model, row.status, row.runId === run.id, row.iso, row.startedAt.getTime() === run.startedAt.getTime()].join(" ")).sort().join("\\n"));
console.log(JSON.stringify(counted));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const printed = lines(result.stdout);
    const stats = printed.at(-1);
    const listed = printed.slice(0, -1);
    expect(listed).toEqual([
      "install composer-2.5 failed true https://example.com/omarchy.iso true",
      "lock grok-4.6 passed true https://example.com/omarchy.iso true",
    ]);
    expect(JSON.parse(stats ?? "")).toEqual([
      { model: "composer-2.5", succeeded: 0, failed: 1 },
      { model: "grok-4.6", succeeded: 1, failed: 0 },
    ]);
  });

  it("lists base prompts and ends the connection", async () => {
    const result = await runQuery(
      "const rows = await query.listTestBasePrompts(url);\nconsole.log(rows.map((row) => `${row.name} ${typeof row.prompt}`).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows = lines(result.stdout);
    expect(rows).toContain("base string");
    for (const row of rows) {
      expect(row).toMatch(/^\S+ string$/);
    }
  });

  it("returns undefined for an unknown image id and still exits", async () => {
    const result = await runQuery(
      'const image = await query.getImage(url, "00000000-0000-4000-8000-000000000000");\nconsole.log(String(image));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("undefined\n");
  });
});

describe.skipIf(dbUrl === "")("dashboard/query unhappy path: failed query", () => {
  it("surfaces the Postgres error from a failed query and still ends the connection", async () => {
    const result = await runQuery(
      'try {\n  await query.getImage(url, "not-a-uuid");\n} catch (err) {\n  console.error(`${err.message}: ${err.cause.message}`);\n  process.exitCode = 3;\n}',
      dbUrl,
    );
    expect(
      result.hung,
      "process did not exit: the pg client was not ended after the failed query",
    ).toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/Failed query: select "data"/);
    expect(result.stderr).toMatch(/invalid input syntax for type uuid/);
  });
});

type Page = {
  readonly status: number;
  readonly html: string;
};

// The Worker in-process: the Hono app answers a Request with the Hyperdrive binding pointed at
// the container, so the page is what production renders from these rows.
const getPage = async (path: string, databaseUrl: string): Promise<Page> => {
  const response = await app.request(path, undefined, {
    HYPERDRIVE: { connectionString: databaseUrl },
  });
  return { status: response.status, html: await response.text() };
};

const seed = async (databaseUrl: string, run: (db: NodePgDatabase) => Promise<void>) => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await run(drizzle(client));
  } finally {
    await client.end();
  }
};

// The card the wide layout shows: the list item marked current, up to the next item or the end
// of the list (the model chart nests its own list items, so a bare </li> is not the end).
const currentCard = (html: string): string =>
  /<li class="definitions__item definitions__item--current">([\s\S]*?)<\/li>\s*(?:<li class="definitions__item|<\/ol>)/.exec(
    html,
  )?.[1] ?? "";

// The sidebar links marked current: one when a definition is selected, none on a stale link.
const currentLinks = (html: string): number =>
  (html.match(/class="definitions__link definitions__link--current"/g) ?? []).length;

// The version strip of the current card: the links, in order, with the one marked current.
const versionStrip = (
  card: string,
): ReadonlyArray<{ readonly href: string; readonly label: string; readonly current: boolean }> =>
  [...card.matchAll(/<a ([^>]*class="definition__version[^"]*"[^>]*)>([^<]+)<\/a>/g)].map(
    ([, attributes, label]) => ({
      href: /href="([^"]+)"/.exec(attributes ?? "")?.[1] ?? "",
      label: label ?? "",
      current: (attributes ?? "").includes('aria-current="true"'),
    }),
  );

// Every result here is its own run: a run holds one result per definition.
const seedResults = async (
  db: NodePgDatabase,
  definitionId: number,
  outcomes: ReadonlyArray<{
    readonly status: (typeof testResults.$inferInsert)["status"];
    readonly model: string;
  }>,
): Promise<ReadonlyArray<string>> => {
  const runs = await db
    .insert(testRuns)
    .values(
      outcomes.map(() => ({
        name: "wide",
        iso: "https://example.com/omarchy.iso",
        serverUrl: "http://127.0.0.1:42069",
      })),
    )
    .returning({ id: testRuns.id });
  await db.insert(testResults).values(
    outcomes.map((outcome, index) => ({
      runId: runs[index].id,
      definitionId,
      status: outcome.status,
      model: outcome.model,
    })),
  );
  return runs.map((run) => run.id);
};

describe.skipIf(dbUrl === "")("dashboard/definitions page happy path", () => {
  it("lists every definition as a sidebar link and selects the first when no name is asked for", async () => {
    const { status, html } = await getPage("/definitions", dbUrl);
    expect(status).toBe(200);
    expect(html).toContain('href="/definitions?name=lock-screen"');
    expect(currentLinks(html)).toBe(1);
    expect(currentCard(html)).toMatch(/<h2>[^<]+<\/h2>/);
  });

  it("selects the definition named by ?name, marks its link current and charts its results by model", async () => {
    let runIds: ReadonlyArray<string> = [];
    await seed(dbUrl, async (db) => {
      const [charted] = await db
        .insert(testDefinitions)
        .values({ name: "wide layout", description: "d", instruction: "i", proof: "p" })
        .returning({ id: testDefinitions.id });
      runIds = await seedResults(db, charted.id, [
        { status: "passed", model: "grok-4.6" },
        { status: "failed", model: "grok-4.6" },
        { status: "passed", model: "composer-2.5" },
        { status: "pending", model: "gemini-3.8" },
      ]);
    });
    const { status, html } = await getPage("/definitions?name=wide%20layout", dbUrl);
    expect(status).toBe(200);
    expect(html).toMatch(
      /<a [^>]*href="\/definitions\?name=wide%20layout"[^>]*aria-current="true"[^>]*>wide layout<\/a>/,
    );
    expect(currentLinks(html)).toBe(1);
    const card = currentCard(html);
    expect(card).toContain("<h2>wide layout</h2>");
    expect(card).toContain('aria-label="composer-2.5: 1 succeeded, 0 failed"');
    expect(card).toContain('aria-label="grok-4.6: 1 succeeded, 1 failed"');
    expect(card).toContain('aria-label="v1: 2 succeeded, 1 failed"');
    expect(card).not.toContain("gemini-3.8:");
    expect(card).not.toContain("lock-screen");
    // One wording so far: a strip of one, current. Every run that used it is listed, the pending
    // one included, with its model and status.
    expect(versionStrip(card).map((link) => [link.label, link.current])).toEqual([["v1", true]]);
    for (const runId of runIds) {
      expect(card).toContain(`<code>${runId}</code>`);
    }
    expect(card).toContain("<td>gemini-3.8</td>");
    expect(card).toContain("<td>pending</td>");
  });

  it("shows one name for two wordings, the newest selected, each charted by version", async () => {
    let olderId = 0;
    let newerId = 0;
    let olderRuns: ReadonlyArray<string> = [];
    let newerRuns: ReadonlyArray<string> = [];
    await seed(dbUrl, async (db) => {
      const [older] = await db
        .insert(testDefinitions)
        .values({ name: "wide-versions", description: "d", instruction: "first", proof: "p" })
        .returning({ id: testDefinitions.id });
      const [newer] = await db
        .insert(testDefinitions)
        .values({ name: "wide-versions", description: "d", instruction: "second", proof: "p" })
        .returning({ id: testDefinitions.id });
      olderId = older.id;
      newerId = newer.id;
      olderRuns = await seedResults(db, older.id, [
        { status: "passed", model: "grok-4.6" },
        { status: "failed", model: "grok-4.6" },
      ]);
      newerRuns = await seedResults(db, newer.id, [{ status: "passed", model: "composer-2.5" }]);
    });

    const newest = await getPage("/definitions?name=wide-versions", dbUrl);
    expect(newest.status).toBe(200);
    expect(newest.html.match(/href="\/definitions\?name=wide-versions"/g)).toHaveLength(1);
    expect(currentLinks(newest.html)).toBe(1);
    const newestCard = currentCard(newest.html);
    expect(newestCard).toContain("<h2>wide-versions</h2>");
    expect(versionStrip(newestCard)).toEqual([
      {
        href: `/definitions?name=wide-versions&amp;id=${String(olderId)}`,
        label: "v1",
        current: false,
      },
      {
        href: `/definitions?name=wide-versions&amp;id=${String(newerId)}`,
        label: "v2",
        current: true,
      },
    ]);
    expect(newestCard).toContain("<p>second</p>");
    expect(newestCard).not.toContain("<p>first</p>");
    // The model chart is the selected wording's; the version chart is the whole name's.
    expect(newestCard).toContain('aria-label="composer-2.5: 1 succeeded, 0 failed"');
    expect(newestCard).not.toContain('aria-label="grok-4.6:');
    expect(newestCard).toContain('aria-label="v1: 1 succeeded, 1 failed"');
    expect(newestCard).toContain('aria-label="v2: 1 succeeded, 0 failed"');
    for (const runId of newerRuns) {
      expect(newestCard).toContain(`<code>${runId}</code>`);
    }
    for (const runId of olderRuns) {
      expect(newestCard).not.toContain(runId);
    }

    const older = await getPage(`/definitions?name=wide-versions&id=${String(olderId)}`, dbUrl);
    expect(older.status).toBe(200);
    expect(currentLinks(older.html)).toBe(1);
    const olderCard = currentCard(older.html);
    expect(versionStrip(olderCard).map((link) => [link.label, link.current])).toEqual([
      ["v1", true],
      ["v2", false],
    ]);
    expect(olderCard).toContain("<p>first</p>");
    expect(olderCard).not.toContain("<p>second</p>");
    expect(olderCard).toContain('aria-label="grok-4.6: 1 succeeded, 1 failed"');
    expect(olderCard).not.toContain("composer-2.5:");
    expect(olderCard).toContain('aria-label="v2: 1 succeeded, 0 failed"');
    for (const runId of olderRuns) {
      expect(olderCard).toContain(`<code>${runId}</code>`);
    }
    for (const runId of newerRuns) {
      expect(olderCard).not.toContain(runId);
    }
  });

  it("says so in the charts and the run list when the selected definition has not run yet", async () => {
    await seed(dbUrl, async (db) => {
      await db
        .insert(testDefinitions)
        .values({ name: "wide-unrun", description: "d", instruction: "i", proof: "p" });
    });
    const { status, html } = await getPage("/definitions?name=wide-unrun", dbUrl);
    expect(status).toBe(200);
    const card = currentCard(html);
    expect(card).toContain("<h2>wide-unrun</h2>");
    expect(card).toContain("No passed or failed results yet.");
    expect(card).toContain("No runs yet.");
    expect(card).not.toContain('class="result-chart__bar"');
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions page unhappy path", () => {
  it("answers 404 for a name no definition carries, keeping the sidebar and selecting nothing", async () => {
    const { status, html } = await getPage("/definitions?name=no-such-definition", dbUrl);
    expect(status).toBe(404);
    expect(html).toContain("No test definition named <code>no-such-definition</code>.");
    expect(html).toContain('href="/definitions?name=lock-screen"');
    expect(currentLinks(html)).toBe(0);
    expect(currentCard(html)).toBe("");
  });

  it("answers 404 for an id that is not a version of that name, keeping the sidebar", async () => {
    let otherId = 0;
    await seed(dbUrl, async (db) => {
      const [other] = await db
        .insert(testDefinitions)
        .values({ name: "wide-other", description: "d", instruction: "i", proof: "p" })
        .returning({ id: testDefinitions.id });
      otherId = other.id;
    });
    const { status, html } = await getPage(
      `/definitions?name=lock-screen&id=${String(otherId)}`,
      dbUrl,
    );
    expect(status).toBe(404);
    expect(html).toContain(
      `No version <code>${String(otherId)}</code> of <code>lock-screen</code>.`,
    );
    expect(html).toContain('href="/definitions?name=lock-screen"');
    expect(currentLinks(html)).toBe(0);
    expect(currentCard(html)).toBe("");

    const garbage = await getPage("/definitions?name=lock-screen&id=abc", dbUrl);
    expect(garbage.status).toBe(404);
    expect(garbage.html).toContain("No version <code>abc</code> of <code>lock-screen</code>.");
  });
});

describe.skipIf(dbUrl === "")("dashboard/results page: the test each session ran", () => {
  it("names the definition and its version on the session card", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    await seed(dbUrl, async (db) => {
      await db
        .insert(testDefinitions)
        .values({ name: "card-versions", description: "d", instruction: "first", proof: "p" });
      const [newer] = await db
        .insert(testDefinitions)
        .values({ name: "card-versions", description: "d", instruction: "second", proof: "p" })
        .returning({ id: testDefinitions.id });
      await db
        .insert(sessions)
        .values({ id: sessionId, config: { iso: "z" }, status: "succeeded" });
      const [run] = await db
        .insert(testRuns)
        .values({
          name: "card",
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
        })
        .returning({ id: testRuns.id });
      await db.insert(testResults).values({
        runId: run.id,
        definitionId: newer.id,
        sessionId,
        status: "passed",
        model: "grok-4.6",
      });
    });
    const { status, html } = await getPage("/", dbUrl);
    expect(status).toBe(200);
    expect(html).toContain('<span class="session__version-name">card-versions v2</span>');
  });
});

describe("dashboard/definitions page unhappy path: unreachable database", () => {
  it("answers 500 with the unavailable message and never echoes the password", async () => {
    const { status, html } = await getPage("/definitions?name=lock-screen", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toContain("Test definitions are unavailable.");
    expect(html).not.toContain('href="/definitions?name=');
    expect(html).not.toContain(SENTINEL_PASSWORD);
  });
});

describe("dashboard/query unhappy path: unreachable database", () => {
  it("surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listTestDefinitions(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("surfaces a refused connection from listTestResultOutcomes without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listTestResultOutcomes(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });
});
