import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";
import { app, scheduled } from "../../src/dashboard/dashboard.tsx";
import {
  actions,
  agentRuns,
  agentServers,
  automationJobs,
  debugLogs,
  images,
  logs,
  postRunDiagnosis,
  postRunErrorTypes,
  processStats,
  servers,
  sessionServers,
  sessions,
  testDefinitions,
  testResults,
  testRuns,
} from "../../src/db/schema.ts";
import * as StubProxy from "../support/stub-proxy.ts";

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

  it("lists the newest process reading per name, by type then name, and ends the connection", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(processStats).values([
        {
          name: "proc-qemu",
          type: "qemu",
          jobs: 9,
          memoryBytes: 9,
          cpuPercent: 99,
          reportedAt: sql`now() - interval '1 minute'`,
        },
        {
          name: "proc-qemu",
          type: "qemu",
          jobs: 2,
          memoryBytes: 1000,
          cpuPercent: 12.5,
        },
        {
          name: "proc-auto",
          type: "automation-client",
          jobs: 1,
          memoryBytes: 2000,
          cpuPercent: 4,
        },
      ]);
    });
    const result = await runQuery(
      `
const rows = (await query.listProcessStats(url)).filter((row) => row.name.startsWith("proc-"));
console.log(rows.map((row) => [row.name, row.type, row.jobs, row.memoryBytes, row.cpuPercent, row.reportedAt instanceof Date, row.queriedAt instanceof Date].join(" ")).join("\\n"));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    // `type` is the server_type enum, declared qemu then automation-client, and an enum column
    // orders by declaration: the qemu servers come first, as the servers page lays them out.
    expect(lines(result.stdout)).toEqual([
      "proc-qemu qemu 2 1000 12.5 true true",
      "proc-auto automation-client 1 2000 4 true true",
    ]);
  });

  it("lists the last 60 process readings per name as a series, oldest first, drops a reading older than 30 minutes, and ends the connection", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(processStats).values([
        ...Array.from({ length: 61 }, (_, index) => ({
          name: "series-qemu",
          type: "qemu" as const,
          jobs: index,
          memoryBytes: index,
          cpuPercent: index,
          reportedAt: new Date(Date.now() - (60 - index) * 1_000),
        })),
        {
          name: "series-auto",
          type: "automation-client" as const,
          jobs: 1,
          memoryBytes: 2,
          cpuPercent: 3,
        },
        {
          name: "series-qemu",
          type: "qemu" as const,
          jobs: 99,
          memoryBytes: 99,
          cpuPercent: 99,
          reportedAt: new Date(Date.now() - 31 * 60_000),
        },
      ]);
    });
    const result = await runQuery(
      `
const rows = (await query.listProcessSeries(url)).filter((row) => row.name.startsWith("series-"));
console.log(rows.map((row) => [row.name, row.type, row.jobs, row.samples.length, row.samples[0].jobs, row.samples.at(-1).jobs].join(" ")).join("\\n"));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toEqual([
      "series-qemu qemu 60 60 1 60",
      "series-auto automation-client 1 1 1 1",
    ]);
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

const seed = async <T>(
  databaseUrl: string,
  run: (db: NodePgDatabase) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(drizzle(client));
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

// The running strip at the top of the definitions page, up to its own end. It has no nested
// section, so the first close is the close.
const runningSection = (html: string): string =>
  /<section class="running-tests"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

const definitionsAbortForm = (
  ticket: string,
  action: QueuedJob["action"],
  definition: string,
): string =>
  `<form method="post" action="/abort" hx-post="/abort" hx-confirm="are you sure?" hx-target="#running-tests" hx-swap="innerHTML"><input type="hidden" name="ticket" value="${ticket}"/><input type="hidden" name="action" value="${action}"/><input type="hidden" name="view" value="definitions"/><input type="hidden" name="definition" value="${definition}"/><button type="submit" class="button button--abort">Abort</button></form>`;

// The wordings of the current card, in page order: each a <details> whose summary names the
// version, the newest open, with the body that follows it up to the next wording or the list's end.
type Wording = { readonly label: string; readonly open: boolean; readonly body: string };
const wordings = (card: string): ReadonlyArray<Wording> =>
  [
    ...card.matchAll(
      /<details class="definition__wording"([^>]*)>\s*<summary[^>]*>[\s\S]*?<span class="definition__wording-label">([^<]+)<\/span>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/g,
    ),
  ].map(([, attributes, label, body]) => ({
    label: label ?? "",
    open: (attributes ?? "").includes("open"),
    body: body ?? "",
  }));

// The edit form of the current card: the hidden name, each field's prefilled text, and the update
// button's label and whether the page hands it over disabled.
const editForm = (
  card: string,
): {
  readonly name: string;
  readonly fields: Record<string, string>;
  readonly button: string;
  readonly disabled: boolean;
} => {
  const form =
    /<form method="post" action="\/definitions"[^>]*>([\s\S]*?)<\/form>/.exec(card)?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const [, field, text] of form.matchAll(
    /<textarea name="([a-z]+)"[^>]*>([\s\S]*?)<\/textarea>/g,
  )) {
    fields[field ?? ""] = text ?? "";
  }
  const button = /<button([^>]*type="submit"[^>]*)>([\s\S]*?)<\/button>/.exec(form);
  return {
    name: /<input type="hidden" name="name" value="([^"]*)"/.exec(form)?.[1] ?? "",
    fields,
    button: button?.[2] ?? "",
    disabled: (button?.[1] ?? "").includes("disabled"),
  };
};

// A form submission as the browser sends it, answered without following the redirect.
const postForm = async (
  fields: Record<string, string>,
  databaseUrl: string,
  path = "/definitions",
): Promise<{
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
}> => {
  const response = await app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    { HYPERDRIVE: { connectionString: databaseUrl } },
  );
  return {
    status: response.status,
    location: response.headers.get("location"),
    text: await response.text(),
  };
};

const wordingsOf = async (databaseUrl: string, name: string): Promise<ReadonlyArray<string>> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const rows = await drizzle(client)
      .select({ instruction: testDefinitions.instruction })
      .from(testDefinitions)
      .where(eq(testDefinitions.name, name))
      .orderBy(testDefinitions.id);
    return rows.map((row) => row.instruction);
  } finally {
    await client.end();
  }
};

// Every result here is its own run: a run holds one result per definition.
const seedResults = async (
  db: NodePgDatabase,
  definitionId: number,
  outcomes: ReadonlyArray<{
    readonly status: (typeof testResults.$inferInsert)["status"];
    readonly model: string;
    readonly createdAt?: Date;
    readonly finishedAt?: Date;
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
    outcomes.map((outcome, index) =>
      Object.assign(
        {
          runId: runs[index].id,
          definitionId,
          status: outcome.status,
          model: outcome.model,
        },
        outcome.createdAt === undefined ? undefined : { createdAt: outcome.createdAt },
        outcome.finishedAt === undefined ? undefined : { finishedAt: outcome.finishedAt },
      ),
    ),
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
    // One wording so far, open. The pending run is not a passed or failed result, so it is
    // not in either chart, and the page no longer lists individual runs.
    const [only, ...rest] = wordings(card);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ label: "v1", open: true });
    expect(card).not.toContain('<table class="runs"');
    for (const runId of runIds) {
      expect(card).not.toContain(`<code>${runId}</code>`);
    }
  });

  it("lines a name's wordings up newest first, the newest open, each with its own charts", async () => {
    await seed(dbUrl, async (db) => {
      const [older] = await db
        .insert(testDefinitions)
        .values({ name: "wide-versions", description: "d", instruction: "first", proof: "p" })
        .returning({ id: testDefinitions.id });
      const [newer] = await db
        .insert(testDefinitions)
        .values({ name: "wide-versions", description: "d", instruction: "second", proof: "p" })
        .returning({ id: testDefinitions.id });
      await seedResults(db, older.id, [
        { status: "passed", model: "grok-4.6" },
        { status: "failed", model: "grok-4.6" },
      ]);
      await seedResults(db, newer.id, [{ status: "passed", model: "composer-2.5" }]);
    });

    const { status, html } = await getPage("/definitions?name=wide-versions", dbUrl);
    expect(status).toBe(200);
    // One sidebar entry for the name, however many wordings it has.
    expect(html.match(/href="\/definitions\?name=wide-versions"/g)).toHaveLength(1);
    expect(currentLinks(html)).toBe(1);
    const card = currentCard(html);
    expect(card).toContain("<h2>wide-versions</h2>");
    // The version chart spans the name; each wording carries its own text and charts.
    expect(card).toContain('aria-label="v1: 1 succeeded, 1 failed"');
    expect(card).toContain('aria-label="v2: 1 succeeded, 0 failed"');
    const [v2, v1, ...rest] = wordings(card);
    expect(rest).toEqual([]);
    expect(v2).toMatchObject({ label: "v2", open: true });
    expect(v1).toMatchObject({ label: "v1", open: false });
    expect(v2?.body).toContain("<p>second</p>");
    expect(v2?.body).not.toContain("<p>first</p>");
    expect(v2?.body).toContain('aria-label="composer-2.5: 1 succeeded, 0 failed"');
    expect(v2?.body).not.toContain("grok-4.6:");
    expect(v1?.body).toContain("<p>first</p>");
    expect(v1?.body).not.toContain("<p>second</p>");
    expect(v1?.body).toContain('aria-label="grok-4.6: 1 succeeded, 1 failed"');
    expect(v1?.body).not.toContain("composer-2.5:");
    expect(card).not.toContain('<table class="runs"');
  });

  it("keeps only the current wording and the one before it, even when a name has more", async () => {
    await seed(dbUrl, async (db) => {
      const [oldest] = await db
        .insert(testDefinitions)
        .values({ name: "wide-three", description: "d", instruction: "first", proof: "p" })
        .returning({ id: testDefinitions.id });
      const [middle] = await db
        .insert(testDefinitions)
        .values({ name: "wide-three", description: "d", instruction: "second", proof: "p" })
        .returning({ id: testDefinitions.id });
      const [newest] = await db
        .insert(testDefinitions)
        .values({ name: "wide-three", description: "d", instruction: "third", proof: "p" })
        .returning({ id: testDefinitions.id });
      await seedResults(db, oldest.id, [{ status: "passed", model: "grok-4.6" }]);
      await seedResults(db, middle.id, [{ status: "failed", model: "grok-4.6" }]);
      await seedResults(db, newest.id, [{ status: "passed", model: "composer-2.5" }]);
    });
    const { status, html } = await getPage("/definitions?name=wide-three", dbUrl);
    expect(status).toBe(200);
    const card = currentCard(html);
    expect(wordings(card).map((wording) => wording.label)).toEqual(["v3", "v2"]);
    expect(card).toContain("<p>third</p>");
    expect(card).toContain("<p>second</p>");
    expect(card).not.toContain("<p>first</p>");
    expect(card).toContain('aria-label="v2: 0 succeeded, 1 failed"');
    expect(card).toContain('aria-label="v3: 1 succeeded, 0 failed"');
    expect(card).not.toContain('aria-label="v1:');
  });

  it("charts the last timed runs by duration, shortest first, with percentiles under each chart", async () => {
    await seed(dbUrl, async (db) => {
      const [definition] = await db
        .insert(testDefinitions)
        .values({ name: "wide-duration", description: "d", instruction: "i", proof: "p" })
        .returning({ id: testDefinitions.id });
      await seedResults(db, definition.id, [
        {
          status: "failed",
          model: "grok-4.6",
          createdAt: new Date("2026-09-01T00:00:00Z"),
          finishedAt: new Date("2026-09-01T00:04:00Z"),
        },
        {
          status: "passed",
          model: "grok-4.6",
          createdAt: new Date("2026-09-01T00:10:00Z"),
          finishedAt: new Date("2026-09-01T00:11:00Z"),
        },
        {
          status: "passed",
          model: "composer-2.5",
          createdAt: new Date("2026-09-01T00:20:00Z"),
          finishedAt: new Date("2026-09-01T00:22:00Z"),
        },
      ]);
    });
    const { status, html } = await getPage("/definitions?name=wide-duration", dbUrl);
    expect(status).toBe(200);
    const card = currentCard(html);
    expect(card).toContain("Last 50 runs by duration");
    expect(card).toContain('aria-label="succeeded in 1 min"');
    expect(card).toContain('aria-label="succeeded in 2 min"');
    expect(card).toContain('aria-label="failed in 4 min"');
    const firstBar = card.indexOf('aria-label="succeeded in 1 min"');
    const secondBar = card.indexOf('aria-label="succeeded in 2 min"');
    const thirdBar = card.indexOf('aria-label="failed in 4 min"');
    expect(firstBar).toBeGreaterThan(-1);
    expect(firstBar).toBeLessThan(secondBar);
    expect(secondBar).toBeLessThan(thirdBar);
    expect(card).toContain("10%");
    expect(card).toContain("25%");
    expect(card).toContain("median");
    expect(card).toContain("75%");
    expect(card).toContain("90%");
    expect(card).toContain("99%");
    expect(card).toContain("1 min");
    expect(card).toContain("2 min");
    expect(card).toContain("4 min");
  });

  it("shows the newest wording in a form, the name fixed, its update button handed over disabled", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(testDefinitions).values([
        { name: "wide-edit", description: "old d", instruction: "old i", proof: "old p" },
        { name: "wide-edit", description: "new d", instruction: "new i", proof: "new p" },
      ]);
    });
    const { status, html } = await getPage("/definitions?name=wide-edit", dbUrl);
    expect(status).toBe(200);
    const card = currentCard(html);
    // The form is in the card as it is, not behind a fold; the page's script enables the button
    // once a field differs from the text it was rendered with.
    expect(card).not.toContain('<details class="definition__edit"');
    expect(editForm(card)).toEqual({
      name: "wide-edit",
      fields: { description: "new d", instruction: "new i", proof: "new p" },
      button: "Update",
      disabled: true,
    });
    expect(card).toContain(
      "Updating writes v3 of wide-edit; the earlier wordings keep their runs.",
    );
    expect(html).toContain('<script src="/dashboard.js" defer=""></script>');
    // The name is not a field: it is what the wordings collapse under.
    expect(card).not.toMatch(/<(input|textarea)[^>]*name="name"[^>]*type="text"/);
    expect(card).not.toContain('class="definition__form-notice"');
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
    expect(card).toContain("No timed passed or failed results yet.");
    expect(card).not.toContain('class="result-chart__bar"');
    expect(card).not.toContain('<table class="runs"');
    expect(card).not.toContain("No runs yet.");
  });

  it("lists every running test at the top of the main area, and offers to abort one that has a ticket", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "running-on-definitions", [
        {
          ticket: "RUN-1",
          action: "drive",
          status: "running",
          queuedSecondsAgo: 120,
          startedSecondsAgo: 45,
        },
        {
          ticket: "RUN-2",
          action: "diagnose",
          status: "running",
          queuedSecondsAgo: 30,
          startedSecondsAgo: 10,
        },
        {
          ticket: null,
          action: "drive",
          status: "running",
          queuedSecondsAgo: 20,
          startedSecondsAgo: 8,
        },
        { ticket: "RUN-PEND", action: "drive", status: "pending", queuedSecondsAgo: 5 },
        {
          ticket: "RUN-DONE",
          action: "drive",
          status: "succeeded",
          queuedSecondsAgo: 400,
          startedSecondsAgo: 300,
          finishedSecondsAgo: 60,
        },
      ]),
    );
    const { status, html } = await getPage("/definitions?name=running-on-definitions", dbUrl);
    expect(status).toBe(200);
    const runningAt = html.indexOf('<section class="running-tests"');
    const headingAt = html.indexOf('id="definitions-heading"');
    const layoutAt = html.indexOf('class="definitions__layout"');
    expect(headingAt).toBeGreaterThan(-1);
    expect(runningAt).toBeGreaterThan(headingAt);
    expect(layoutAt).toBeGreaterThan(runningAt);
    const running = runningSection(html);
    expect(running).toContain(
      '<div id="running-tests" hx-get="/definitions/running?name=running-on-definitions" hx-trigger="every 30s" hx-swap="innerHTML">',
    );
    // Diagnoses ahead of drives, then queue order: the pending and finished jobs are not running.
    const diagnose = running.indexOf(">RUN-2<");
    const drive = running.indexOf(">RUN-1<");
    const unticketed = running.indexOf(">—</span>");
    expect(diagnose).toBeGreaterThan(-1);
    expect(diagnose).toBeLessThan(drive);
    expect(drive).toBeLessThan(unticketed);
    expect(running).not.toContain("RUN-PEND");
    expect(running).not.toContain("RUN-DONE");
    expect(running).toContain(
      '<a href="/definitions?name=running-on-definitions">running-on-definitions</a>',
    );
    expect(running).toContain(definitionsAbortForm("RUN-2", "diagnose", "running-on-definitions"));
    expect(running).toContain(definitionsAbortForm("RUN-1", "drive", "running-on-definitions"));
    expect(running.match(/action="\/abort"/g)).toHaveLength(2);
    expect(html.indexOf('class="definitions__nav"')).toBeGreaterThan(runningAt);
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions page unhappy path", () => {
  it("says nothing is running, and offers no abort, when every job is waiting or finished", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "nothing-running", [
        pendingJob("RUN-NONE"),
        {
          ticket: "RUN-FINISHED",
          action: "drive",
          status: "failed",
          queuedSecondsAgo: 80,
          startedSecondsAgo: 40,
          finishedSecondsAgo: 10,
        },
      ]),
    );
    const { status, html } = await getPage("/definitions?name=lock-screen", dbUrl);
    expect(status).toBe(200);
    const running = runningSection(html);
    expect(running).toContain("No tests are running.");
    expect(running).not.toContain("RUN-NONE");
    expect(running).not.toContain("RUN-FINISHED");
    expect(running).not.toContain('action="/abort"');
    expect(html.indexOf('<section class="running-tests"')).toBeLessThan(
      html.indexOf('class="definitions__layout"'),
    );
  });

  it("answers 404 for a name no definition carries, keeping the sidebar and selecting nothing", async () => {
    const { status, html } = await getPage("/definitions?name=no-such-definition", dbUrl);
    expect(status).toBe(404);
    expect(html).toContain("No test definition named <code>no-such-definition</code>.");
    expect(html).toContain('href="/definitions?name=lock-screen"');
    expect(currentLinks(html)).toBe(0);
    expect(currentCard(html)).toBe("");
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions edit happy path", () => {
  it("saves a changed wording as the next version and returns to the name, which now opens on it", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(testDefinitions).values([
        { name: "wide-save", description: "d", instruction: "first", proof: "p" },
        { name: "wide-save", description: "d", instruction: "second", proof: "p" },
      ]);
    });
    // Typed over two lines: the browser sends CRLF, the wording is stored with LF as ctrl writes it.
    const saved = await postForm(
      { name: "wide-save", description: "d", instruction: "third\r\nand more", proof: "p" },
      dbUrl,
    );
    expect(saved.status).toBe(303);
    expect(saved.location).toBe("/definitions?name=wide-save");
    expect(await wordingsOf(dbUrl, "wide-save")).toEqual(["first", "second", "third\nand more"]);

    const { status, html } = await getPage("/definitions?name=wide-save", dbUrl);
    expect(status).toBe(200);
    const card = currentCard(html);
    const [newest] = wordings(card);
    expect(newest).toMatchObject({ label: "v3", open: true });
    expect(newest?.body).toContain("<p>third\nand more</p>");
    expect(wordings(card).map((wording) => wording.label)).toEqual(["v3", "v2"]);
    expect(editForm(card)).toMatchObject({
      fields: { instruction: "third\nand more" },
      button: "Update",
      disabled: true,
    });
    expect(card).toContain(
      "Updating writes v4 of wide-save; the earlier wordings keep their runs.",
    );
  });

  it("saves a wording that changes one field only, the other two as they were (happy)", async () => {
    await seed(dbUrl, async (db) => {
      await db
        .insert(testDefinitions)
        .values({ name: "wide-one-field", description: "d", instruction: "i", proof: "p" });
    });
    const saved = await postForm(
      { name: "wide-one-field", description: "d", instruction: "i", proof: "p2" },
      dbUrl,
    );
    expect(saved.status).toBe(303);
    const { html } = await getPage("/definitions?name=wide-one-field", dbUrl);
    const [newest] = wordings(currentCard(html));
    expect(newest?.body).toContain("<p>p2</p>");
    expect(newest?.body).toContain("<p>i</p>");
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions edit unhappy path", () => {
  it("refuses a wording identical to the newest: nothing is written and the form says so", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(testDefinitions).values({
        name: "wide-same",
        description: "d",
        instruction: "i\nover two lines",
        proof: "p",
      });
    });
    // A browser submits a textarea's newlines as CRLF; the wording ctrl wrote has LF.
    const same = await postForm(
      { name: "wide-same", description: "d", instruction: "i\r\nover two lines", proof: "p" },
      dbUrl,
    );
    expect(same.status).toBe(303);
    expect(same.location).toBe("/definitions?name=wide-same&edit=unchanged");
    expect(await wordingsOf(dbUrl, "wide-same")).toEqual(["i\nover two lines"]);

    const { status, html } = await getPage("/definitions?name=wide-same&edit=unchanged", dbUrl);
    expect(status).toBe(200);
    const card = currentCard(html);
    expect(card).toContain('<p class="definition__form-notice" role="alert">');
    expect(card).toContain("Nothing changed: the newest wording already reads like this.");
  });

  it("refuses an empty field: nothing is written and the form says so", async () => {
    await seed(dbUrl, async (db) => {
      await db
        .insert(testDefinitions)
        .values({ name: "wide-empty", description: "d", instruction: "i", proof: "p" });
    });
    const empty = await postForm(
      { name: "wide-empty", description: "d", instruction: "", proof: "p" },
      dbUrl,
    );
    expect(empty.status).toBe(303);
    expect(empty.location).toBe("/definitions?name=wide-empty&edit=empty");
    const missing = await postForm({ name: "wide-empty", description: "d", proof: "p" }, dbUrl);
    expect(missing.status).toBe(303);
    expect(missing.location).toBe("/definitions?name=wide-empty&edit=empty");
    expect(await wordingsOf(dbUrl, "wide-empty")).toEqual(["i"]);

    const { html } = await getPage("/definitions?name=wide-empty&edit=empty", dbUrl);
    const card = currentCard(html);
    expect(card).toContain('<p class="definition__form-notice" role="alert">');
    expect(card).toContain("Every field needs text.");
  });

  it("answers 404 for a name nobody carries, or none at all: a new test is ctrl test define's", async () => {
    const unknown = await postForm(
      { name: "wide-nobody", description: "d", instruction: "i", proof: "p" },
      dbUrl,
    );
    expect(unknown.status).toBe(404);
    const nameless = await postForm({ description: "d", instruction: "i", proof: "p" }, dbUrl);
    expect(nameless.status).toBe(404);
    expect(await wordingsOf(dbUrl, "wide-nobody")).toEqual([]);
  });

  it("shows a stale ?edit value as no notice at all", async () => {
    const { status, html } = await getPage("/definitions?name=lock-screen&edit=whatever", dbUrl);
    expect(status).toBe(200);
    expect(currentCard(html)).not.toContain('class="definition__form-notice"');
  });
});

describe("dashboard/definitions edit unhappy path: unreachable database", () => {
  it("answers 500 without echoing the password", async () => {
    const result = await postForm(
      { name: "lock-screen", description: "d", instruction: "i", proof: "p" },
      REFUSED_URL,
    );
    expect(result.status).toBe(500);
    expect(result.text).toContain("Test definitions are unavailable.");
    expect(result.text).not.toContain(SENTINEL_PASSWORD);
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

describe.skipIf(dbUrl === "")("dashboard/definitions running fragment", () => {
  it("serves the running list alone at /definitions/running, what the top of the page polls for", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "running-fragment", [runningJob("RUN-FRAG"), pendingJob("RUN-FRAG-PEND")]),
    );
    const { status, html } = await getPage("/definitions/running?name=running-fragment", dbUrl);
    expect(status).toBe(200);
    expect(html.startsWith('<ol class="running-tests__list">')).toBe(true);
    expect(html).toContain(definitionsAbortForm("RUN-FRAG", "drive", "running-fragment"));
    expect(html).not.toContain("RUN-FRAG-PEND");
    expect(html).not.toContain("<html");
    expect(html).not.toContain("definitions-heading");
  });

  it("lists every running job, past the fifty the queue page shows", async () => {
    const running: ReadonlyArray<QueuedJob> = Array.from({ length: 51 }, (_, index) => ({
      ticket: `RUN-ALL-${String(index)}`,
      action: "drive",
      status: "running",
      queuedSecondsAgo: 1_000 - index,
      startedSecondsAgo: 1_000 - index,
    }));
    await seed(dbUrl, (db) =>
      seedQueue(db, "running-all", [...running, pendingJob("RUN-ALL-PEND")]),
    );
    const page = await getPage("/definitions?name=running-all", dbUrl);
    expect(page.status).toBe(200);
    const runningHtml = runningSection(page.html);
    expect(runningHtml.match(/action="\/abort"/g)).toHaveLength(51);
    expect(runningHtml.indexOf(">RUN-ALL-0<")).toBeLessThan(runningHtml.indexOf(">RUN-ALL-50<"));
    expect(runningHtml).not.toContain("RUN-ALL-PEND");
    const fragment = await getPage("/definitions/running?name=running-all", dbUrl);
    expect(fragment.status).toBe(200);
    expect(fragment.html.match(/action="\/abort"/g)).toHaveLength(51);
    expect(fragment.html).not.toContain("RUN-ALL-PEND");
  });

  it("keeps an empty ?name on the running poll, the same name the page was asked for", async () => {
    await seed(dbUrl, (db) => seedQueue(db, "running-empty-name", [pendingJob("RUN-EMPTY")]));
    const { status, html } = await getPage("/definitions?name=", dbUrl);
    expect(status).toBe(404);
    expect(runningSection(html)).toContain('hx-get="/definitions/running?name="');
  });

  it("serves the empty line alone when nothing is running", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "running-fragment-empty", [pendingJob("RUN-FRAG-NONE")]),
    );
    const { status, html } = await getPage("/definitions/running", dbUrl);
    expect(status).toBe(200);
    expect(html).toBe('<p class="running-tests__empty">No tests are running.</p>');
  });
});

describe("dashboard/definitions running fragment unhappy path", () => {
  it("answers 500 when the database is unreachable and never echoes the password", async () => {
    const { status, html } = await getPage("/definitions/running", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toBe("<p>error: internal error</p>");
    expect(html).not.toContain(SENTINEL_PASSWORD);
  });
});

describe("dashboard/definitions page unhappy path: unreachable database", () => {
  it("answers 500 with the unavailable message and never echoes the password", async () => {
    const { status, html } = await getPage("/definitions?name=lock-screen", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toContain("Test definitions are unavailable.");
    expect(html).not.toContain('href="/definitions?name=');
    expect(html).not.toContain('id="running-tests"');
    expect(html).not.toContain("No tests are running.");
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

  it("listProcessStats surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listProcessStats(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("listProcessSeries surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listProcessSeries(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });
});

const registered = async (
  databaseUrl: string,
): Promise<ReadonlyArray<{ readonly url: string; readonly type: string }>> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await drizzle(client).select({ url: servers.url, type: servers.type }).from(servers);
  } finally {
    await client.end();
  }
};

const registeredUrls = async (databaseUrl: string): Promise<ReadonlyArray<string>> =>
  (await registered(databaseUrl)).map((row) => row.url);

describe.skipIf(dbUrl === "")("dashboard/servers page happy path", () => {
  it("lists the fleet from its rows: one heard from just now, one silent, one never heard from", async () => {
    // The integration files share one database; the fleet this page expects is its own to arrange.
    await seed(dbUrl, async (db) => {
      await db.delete(processStats);
      await db.delete(servers);
      await db.insert(servers).values([
        {
          url: "http://10.1.0.1:42069",
          name: "garage",
          stats: {
            qemus: 2,
            memory: { totalBytes: 66_900_000_000, usedBytes: 31_500_000_000 },
            cpu: { mean1m: 12.3, mean2m: 11, mean3m: 9.8 },
          },
          generation: 42,
          heartbeatAt: sql`now() - interval '12 seconds'`,
        },
        {
          url: "http://10.1.0.2:42069",
          name: "attic",
          stats: {
            qemus: 3,
            memory: { totalBytes: 16_000_000_000, usedBytes: 4_000_000_000 },
            cpu: { mean1m: 50, mean2m: 40, mean3m: 30 },
          },
          generation: 7,
          heartbeatAt: sql`now() - interval '5 minutes'`,
        },
        { url: "http://10.1.0.3:42069" },
        {
          url: "http://10.1.0.4:54322",
          name: "workshop",
          type: "automation-client",
          stats: {
            qemus: 0,
            memory: { totalBytes: 16_000_000_000, usedBytes: 2_000_000_000 },
            cpu: { mean1m: 4, mean2m: 3, mean3m: 2 },
          },
          generation: 3,
          heartbeatAt: sql`now() - interval '8 seconds'`,
        },
      ]);
      await db.insert(processStats).values([
        {
          name: "garage",
          type: "qemu",
          jobs: 2,
          memoryBytes: 512_000_000,
          cpuPercent: 37.5,
          reportedAt: sql`now() - interval '12 seconds'`,
        },
        {
          name: "attic",
          type: "qemu",
          jobs: 3,
          memoryBytes: 256_000_000,
          cpuPercent: 80,
          reportedAt: sql`now() - interval '5 minutes'`,
        },
        {
          name: "workshop",
          type: "automation-client",
          jobs: 1,
          memoryBytes: 128_000_000,
          cpuPercent: 8,
          reportedAt: sql`now() - interval '8 seconds'`,
        },
      ]);
    });
    const { status, html } = await getPage("/servers", dbUrl);
    expect(status).toBe(200);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>oligarchy servers</h1>");
    expect(html).toContain('<div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s">');
    expect(html).toContain(
      "<tr><td>garage</td><td>http://10.1.0.1:42069</td><td>2</td><td>31.5 / 66.9 GB</td><td>12.3% / 11.0% / 9.8%</td><td>42</td><td>12 s ago</td>",
    );
    expect(html).toContain(
      '<tr><td>attic</td><td>http://10.1.0.2:42069</td><td colspan="3"><strong>silent</strong></td><td>7</td><td>5 min ago</td>',
    );
    expect(html).toContain(
      '<tr><td>—</td><td>http://10.1.0.3:42069</td><td colspan="3">never heard from</td><td>0</td><td>never</td>',
    );
    expect(html).toContain('<div id="process" hx-get="/servers/process" hx-trigger="every 30s">');
    expect(html).toContain("<h3>garage</h3>");
    expect(html).toContain('aria-label="jobs 2 · cpu 37.5% · memory 512.0 MB"');
    expect(html).toContain('<li class="process-graph__memory">memory 512.0 MB</li>');
    expect(html).toContain('<li class="process-graph__jobs">jobs 2</li>');
    expect(html).toContain('<li class="process-graph__cpu">cpu 37.5%</li>');
    expect(html).toContain('class="process-cards"');
    expect(html).toMatch(/body\s*\{[^}]*background:\s*#161616/);
    expect(html).toContain('class="process-graph__jobs"');
    expect(html).toContain('class="process-graph__cpu"');
    expect(html).toContain("process-graph__bar");
    expect(html.indexOf("<h2>process</h2>")).toBeLessThan(html.indexOf("<h2>automation</h2>"));
    expect(html).toContain("<h3>attic</h3>");
    expect(html).toContain("<p><strong>silent</strong></p>");
    expect(html).toContain("<h3>workshop</h3>");
    expect(html).toContain('aria-label="jobs 1 · cpu 8.0% · memory 128.0 MB"');
    expect(html).not.toContain("dashboard.css");
  });

  it("does not list an automation-client among the qemu fleet", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(servers).values({ url: "http://10.1.0.1:42069" }).onConflictDoNothing();
      await db.delete(servers).where(eq(servers.url, "http://10.1.0.4:54322"));
      await db.insert(servers).values({
        url: "http://10.1.0.4:54322",
        type: "automation-client",
      });
    });
    const page = await getPage("/servers", dbUrl);
    expect(page.html).toContain("<td>http://10.1.0.1:42069</td>");
    const fleet = await getPage("/servers/fleet", dbUrl);
    expect(fleet.html).toContain("<td>http://10.1.0.1:42069</td>");
    expect(fleet.html).not.toContain("http://10.1.0.4:54322");
  });

  it("serves the process graphs alone at /servers/process, what the page's poll swaps in", async () => {
    const { status, html } = await getPage("/servers/process", dbUrl);
    expect(status).toBe(200);
    expect(html).toContain('<article class="process-card">');
    expect(html).toContain("<h3>garage</h3>");
    expect(html).toContain('aria-label="jobs 2 · cpu 37.5% · memory 512.0 MB"');
    expect(html).toContain("process-graph__bar");
    expect(html).toContain('class="process-graph__jobs"');
    expect(html).toContain('class="process-graph__cpu"');
    expect(html).not.toContain("<table>");
    expect(html).not.toContain("<html");
    expect(html).not.toContain("add a server");
  });

  it("serves the fleet alone at /servers/fleet, what the page's poll swaps in", async () => {
    const { status, html } = await getPage("/servers/fleet", dbUrl);
    expect(status).toBe(200);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>http://10.1.0.1:42069</td>");
    expect(html).not.toContain("<html");
    expect(html).not.toContain("add a server");
  });

  it("adds a qemu server once, however often it is posted, and sends the browser back to the page", async () => {
    const first = await postForm({ url: "http://10.1.0.9:42069" }, dbUrl, "/servers");
    expect(first.status).toBe(303);
    expect(first.location).toBe("/servers");
    const again = await postForm({ url: "http://10.1.0.9:42069" }, dbUrl, "/servers");
    expect(again.status).toBe(303);
    const rows = await registered(dbUrl);
    expect(rows.filter((row) => row.url === "http://10.1.0.9:42069")).toEqual([
      { url: "http://10.1.0.9:42069", type: "qemu" },
    ]);
    const { html } = await getPage("/servers", dbUrl);
    expect(html).toContain(
      '<tr><td>—</td><td>http://10.1.0.9:42069</td><td colspan="3">never heard from</td><td>0</td><td>never</td>',
    );
  });

  it("deletes a server and sends the browser back to the page", async () => {
    const result = await postForm({ url: "http://10.1.0.9:42069" }, dbUrl, "/servers/delete");
    expect(result.status).toBe(303);
    expect(result.location).toBe("/servers");
    expect(await registeredUrls(dbUrl)).not.toContain("http://10.1.0.9:42069");
  });
});

describe.skipIf(dbUrl === "")("dashboard/servers page unhappy path", () => {
  it("refuses a url that is not http or https: 400, the reason on top of the fleet, nothing stored", async () => {
    const result = await postForm({ url: "ftp://qemu.example.com" }, dbUrl, "/servers");
    expect(result.status).toBe(400);
    expect(result.text).toContain("<p>error: url must be an http or https url</p>");
    expect(result.text).toContain("<td>http://10.1.0.1:42069</td>");
    expect(await registeredUrls(dbUrl)).not.toContain("ftp://qemu.example.com");
  });

  it("refuses a form without a url the same way", async () => {
    const result = await postForm({ nope: "x" }, dbUrl, "/servers");
    expect(result.status).toBe(400);
    expect(result.text).toContain("<p>error: url must be an http or https url</p>");
  });

  it("answers 404 with the reason for deleting a url that was never registered", async () => {
    const result = await postForm({ url: "http://10.1.0.77:42069" }, dbUrl, "/servers/delete");
    expect(result.status).toBe(404);
    expect(result.text).toContain("<p>error: http://10.1.0.77:42069 is not registered</p>");
    expect(result.text).toContain("<td>http://10.1.0.1:42069</td>");
  });
});

type QueuedJob = {
  // null for a result nobody has ticketed yet.
  readonly ticket: string | null;
  readonly action: (typeof automationJobs.$inferInsert)["action"];
  readonly status: (typeof automationJobs.$inferInsert)["status"];
  readonly reason?: string;
  readonly queuedSecondsAgo: number;
  readonly startedSecondsAgo?: number;
  readonly finishedSecondsAgo?: number;
};

// A stamp some seconds before the database's clock, the clock the page reads ages against.
const secondsAgo = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;

// One definition, and per job its own run and result carrying the ticket. The jobs already in the
// database go first: the integration files share one, and the queue this page expects is its own
// to arrange.
const seedQueue = async (
  db: NodePgDatabase,
  name: string,
  jobs: ReadonlyArray<QueuedJob>,
): Promise<void> => {
  await db.delete(automationJobs);
  const [definition] = await db
    .insert(testDefinitions)
    .values({ name, description: "d", instruction: "i", proof: "p" })
    .returning({ id: testDefinitions.id });
  const runs = await db
    .insert(testRuns)
    .values(
      jobs.map((_, index) => ({
        name: `${name} ${String(index)}`,
        iso: "https://example.com/omarchy.iso",
        serverUrl: "http://127.0.0.1:42069",
      })),
    )
    .returning({ id: testRuns.id });
  const results = await db
    .insert(testResults)
    .values(
      jobs.map((job, index) => ({
        runId: runs[index].id,
        definitionId: definition.id,
        linearId: job.ticket,
      })),
    )
    .returning({ id: testResults.id });
  await db.insert(automationJobs).values(
    jobs.map((job, index) => ({
      resultId: results[index].id,
      action: job.action,
      status: job.status,
      reason: job.reason,
      createdAt: secondsAgo(job.queuedSecondsAgo),
      startedAt: job.startedSecondsAgo === undefined ? null : secondsAgo(job.startedSecondsAgo),
      finishedAt: job.finishedSecondsAgo === undefined ? null : secondsAgo(job.finishedSecondsAgo),
    })),
  );
};

// Two running, the diagnose queued after the drive; four pending, a diagnose between two drives
// and one nobody has ticketed; four completed, finishing in another order than they were queued.
const QUEUE_JOBS: ReadonlyArray<QueuedJob> = [
  {
    ticket: "QUE-101",
    action: "drive",
    status: "running",
    queuedSecondsAgo: 300,
    startedSecondsAgo: 200,
  },
  {
    ticket: "QUE-102",
    action: "diagnose",
    status: "running",
    queuedSecondsAgo: 100,
    startedSecondsAgo: 50,
  },
  { ticket: "QUE-103", action: "drive", status: "pending", queuedSecondsAgo: 90 },
  { ticket: "QUE-104", action: "diagnose", status: "pending", queuedSecondsAgo: 30 },
  { ticket: "QUE-105", action: "drive", status: "pending", queuedSecondsAgo: 10 },
  { ticket: null, action: "drive", status: "pending", queuedSecondsAgo: 5 },
  {
    ticket: "QUE-106",
    action: "drive",
    status: "succeeded",
    queuedSecondsAgo: 3_000,
    startedSecondsAgo: 2_900,
    finishedSecondsAgo: 600,
  },
  {
    ticket: "QUE-107",
    action: "drive",
    status: "failed",
    reason: "session timed out",
    queuedSecondsAgo: 2_000,
    startedSecondsAgo: 1_900,
    finishedSecondsAgo: 60,
  },
  {
    ticket: "QUE-108",
    action: "diagnose",
    status: "aborted",
    reason: "run stopped",
    queuedSecondsAgo: 1_000,
    startedSecondsAgo: 900,
    finishedSecondsAgo: 300,
  },
  {
    ticket: "QUE-109",
    action: "drive",
    status: "timed_out",
    reason: "no report",
    queuedSecondsAgo: 4_000,
    startedSecondsAgo: 3_900,
    finishedSecondsAgo: 1_200,
  },
];

// The first test arranges the queue; the page and fragment tests read it as it is; the cap test
// arranges its own last.
describe.skipIf(dbUrl === "")("dashboard/servers page: the automation half happy path", () => {
  it("orders running and pending diagnoses ahead of drives and then in queue order, completed newest finished first, and ends the connection", async () => {
    await seed(dbUrl, (db) => seedQueue(db, "queue-order", QUEUE_JOBS));
    const result = await runQuery(
      `
const queue = await query.listAutomationQueue(url);
console.log(queue.running.map((job) => job.ticket).join(" "));
console.log(queue.pending.map((job) => String(job.ticket)).join(" "));
console.log(queue.completed.map((job) => job.ticket + ":" + job.status).join(" "));
const failed = queue.completed[0];
const waiting = queue.pending[0];
console.log([failed.test, failed.action, failed.reason, failed.createdAt instanceof Date, failed.startedAt instanceof Date, failed.finishedAt instanceof Date, failed.queriedAt instanceof Date, String(waiting.reason), String(waiting.startedAt), String(waiting.finishedAt), String(queue.running[0].finishedAt)].join(" "));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toEqual([
      "QUE-102 QUE-101",
      "QUE-104 QUE-103 QUE-105 null",
      "QUE-107:failed QUE-108:aborted QUE-106:succeeded QUE-109:timed_out",
      "queue-order drive session timed out true true true true null null null null",
    ]);
  });

  it("shows the queue in the automation half, running then pending then completed, beside the fleet", async () => {
    const { status, html } = await getPage("/servers", dbUrl);
    expect(status).toBe(200);
    expect(html).toContain(
      '<div class="halves"><section><h2>automation</h2><div id="queue" hx-get="/servers/queue" hx-trigger="every 30s"><h3>running</h3><table>',
    );
    // The ages are read against the database's clock: a minute has margin, seconds are counted.
    expect(html).toMatch(
      /<tr><td><a class="ticket" href="https:\/\/linear\.app\/issue\/QUE-102">QUE-102<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102">queue-order<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102" tabindex="-1" aria-hidden="true">diagnose<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102" tabindex="-1" aria-hidden="true">running<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102" tabindex="-1" aria-hidden="true">1 min ago<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102" tabindex="-1" aria-hidden="true">\d+ s ago<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102" tabindex="-1" aria-hidden="true">—<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-102" tabindex="-1" aria-hidden="true"><\/a><\/td><td><form method="post" action="\/abort" hx-post="\/abort" hx-confirm="are you sure\?" hx-target="#queue" hx-swap="innerHTML"><input type="hidden" name="ticket" value="QUE-102"\/><input type="hidden" name="action" value="diagnose"\/><button type="submit" class="abort" aria-label="abort"><svg/,
    );
    expect(html).toMatch(
      /<h3>pending<\/h3><table>.*?<tr><td><a class="ticket" href="https:\/\/linear\.app\/issue\/QUE-104">QUE-104<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104">queue-order<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104" tabindex="-1" aria-hidden="true">diagnose<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104" tabindex="-1" aria-hidden="true">pending<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104" tabindex="-1" aria-hidden="true">\d+ s ago<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104" tabindex="-1" aria-hidden="true">—<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104" tabindex="-1" aria-hidden="true">—<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-104" tabindex="-1" aria-hidden="true"><\/a><\/td><td><form method="post" action="\/abort" hx-post="\/abort" hx-confirm="are you sure\?" hx-target="#queue" hx-swap="innerHTML"><input type="hidden" name="ticket" value="QUE-104"\/><input type="hidden" name="action" value="diagnose"\/><button type="submit" class="abort" aria-label="abort"><svg.*?<\/form><\/td><\/tr>.*?>QUE-103<\/a>.*?>QUE-105<\/a>.*?<tr><td>—<\/td><td>queue-order<\/td><td>drive<\/td><td>pending<\/td><td>\d+ s ago<\/td><td>—<\/td><td>—<\/td><td><\/td><td><\/td><\/tr>.*?<h3>completed<\/h3>/s,
    );
    expect(html).toMatch(
      /<h3>completed<\/h3><table>.*?<tr><td><a class="ticket" href="https:\/\/linear\.app\/issue\/QUE-107">QUE-107<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107">queue-order<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107" tabindex="-1" aria-hidden="true">drive<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107" tabindex="-1" aria-hidden="true">failed<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107" tabindex="-1" aria-hidden="true">\d+ min ago<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107" tabindex="-1" aria-hidden="true">\d+ min ago<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107" tabindex="-1" aria-hidden="true">1 min ago<\/a><\/td><td class="follow"><a href="\/tickets\/QUE-107" tabindex="-1" aria-hidden="true">session timed out<\/a><\/td><td><\/td><\/tr>.*?>QUE-108<\/a>.*?>QUE-106<\/a>.*?>QUE-109<\/a>/s,
    );
    expect(html.indexOf("<h2>automation</h2>")).toBeLessThan(html.indexOf("<h2>qemu servers</h2>"));
    expect(html).toContain('<div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s">');
    expect(html).toContain("<h2>add a server</h2>");
  });

  it("serves the queue alone at /servers/queue, what the automation half's poll swaps in", async () => {
    const { status, html } = await getPage("/servers/queue", dbUrl);
    expect(status).toBe(200);
    expect(html.startsWith("<h3>running</h3><table>")).toBe(true);
    expect(html).toContain('href="https://linear.app/issue/QUE-102"');
    expect(html).toContain('href="/tickets/QUE-102"');
    expect(html).toContain('href="https://linear.app/issue/QUE-109"');
    expect(html).toContain('href="/tickets/QUE-109"');
    expect(html).not.toContain("<html");
    expect(html).not.toContain("qemu servers");
    expect(html).not.toContain("add a server");
  });

  it("cuts each list at fifty: the fifty that finished last, the fifty at the front of the queue", async () => {
    const completed: ReadonlyArray<QueuedJob> = Array.from({ length: 55 }, (_, index) => ({
      ticket: `QUE-C-${String(index)}`,
      action: "drive",
      status: "succeeded",
      queuedSecondsAgo: 10_000,
      startedSecondsAgo: 9_000,
      finishedSecondsAgo: index * 60,
    }));
    const pending: ReadonlyArray<QueuedJob> = Array.from({ length: 52 }, (_, index) => ({
      ticket: `QUE-P-${String(index)}`,
      action: "drive",
      status: "pending",
      queuedSecondsAgo: index,
    }));
    await seed(dbUrl, (db) => seedQueue(db, "queue-cap", [...completed, ...pending]));
    const result = await runQuery(
      `
const queue = await query.listAutomationQueue(url);
console.log([queue.completed.length, queue.completed[0].ticket, queue.completed[49].ticket].join(" "));
console.log([queue.pending.length, queue.pending[0].ticket, queue.pending[49].ticket].join(" "));
console.log(queue.running.length);
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toEqual(["50 QUE-C-0 QUE-C-49", "50 QUE-P-51 QUE-P-2", "0"]);
  });
});

// The ticket page is the terminal follow, read from the database: the open step, the command
// under it, the newest frame, and a poll. The feed route is only what that poll swaps in.
describe.skipIf(dbUrl === "")("dashboard ticket follow", () => {
  it("shows the open step, the command under it and the latest frame, and polls every five seconds", async () => {
    const sessionId = randomUUID();
    await seed(dbUrl, async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        config: { iso: "x" },
        status: "running",
      });
      const [definition] = await db
        .insert(testDefinitions)
        .values({
          name: "follow-page",
          description: "d",
          instruction:
            "<ActionList>\n* open a terminal\n* type hello\n* any crashes or erroneous behavior must be reported.\n</ActionList>",
          proof: "p",
        })
        .returning({ id: testDefinitions.id });
      const [run] = await db
        .insert(testRuns)
        .values({
          name: "follow page",
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
        })
        .returning({ id: testRuns.id });
      const [result] = await db
        .insert(testResults)
        .values({
          runId: run.id,
          definitionId: definition.id,
          sessionId,
          linearId: "FOL-1",
          status: "running",
        })
        .returning({ id: testResults.id });
      await db.insert(automationJobs).values({
        resultId: result.id,
        action: "drive",
        status: "running",
      });
      await db.insert(logs).values({
        location: sessionId,
        text: "intent start; open a terminal",
        createdAt: secondsAgo(12),
      });
      const [action] = await db
        .insert(actions)
        .values({
          sessionId,
          request: { execute: "screendump", arguments: {} },
          state: "completed",
          createdAt: secondsAgo(8),
        })
        .returning({ id: actions.id });
      await db.insert(images).values({ actionId: action.id, data: Buffer.from("png") });
    });

    const page = await getPage("/tickets/FOL-1", dbUrl);
    expect(page.status).toBe(200);
    expect(page.html).toContain(
      `<h1 id="follow-heading">following <a href="https://linear.app/issue/FOL-1">FOL-1</a> · <code>${sessionId.slice(0, 8)}</code> running</h1>`,
    );
    expect(page.html).toContain('<p class="follow__step">1/2</p>');
    expect(page.html).toContain("screendump");
    expect(page.html).toContain('class="follow__image" src="/images/');
    expect(page.html).toContain('hx-get="/tickets/FOL-1/feed" hx-trigger="every 5s"');

    const feed = await getPage("/tickets/FOL-1/feed", dbUrl);
    expect(feed.status).toBe(200);
    expect(feed.html).toContain("screendump");
    expect(feed.html).toContain('class="follow__image"');
    expect(feed.html).not.toContain("<html");
    expect(feed.html).not.toContain("hx-trigger");
  });

  it("waits, and keeps polling, when the ticket has not started a session", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "follow-wait", [
        { ticket: "FOL-WAIT", action: "drive", status: "pending", queuedSecondsAgo: 5 },
      ]),
    );
    const page = await getPage("/tickets/FOL-WAIT", dbUrl);
    expect(page.status).toBe(200);
    expect(page.html).toContain("waiting for FOL-WAIT");
    expect(page.html).toContain("session");
    expect(page.html).toContain('hx-trigger="every 5s"');
    expect(page.html).not.toContain("no commands yet");
  });

  it("answers 404 and does not poll when no result carries the ticket", async () => {
    const page = await getPage("/tickets/FOL-NONE", dbUrl);
    const feed = await getPage("/tickets/FOL-NONE/feed", dbUrl);
    expect(page.status).toBe(404);
    expect(feed.status).toBe(404);
    expect(page.html).toContain("No ticket named FOL-NONE");
    expect(page.html).not.toContain("every 5s");
    expect(feed.html).toContain("No ticket named FOL-NONE");
    expect(feed.html).not.toContain("hx-trigger");
  });
});

describe("dashboard/servers page unhappy path: unreachable database", () => {
  it("answers 500 with internal error and neither half's body, never echoing the password", async () => {
    const { status, html } = await getPage("/servers", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toContain("<p>error: internal error</p>");
    expect(html).not.toContain('id="queue"');
    expect(html).not.toContain('id="fleet"');
    expect(html).not.toContain('id="process"');
    expect(html).toContain("<h2>automation</h2>");
    expect(html).toContain("<h2>add a server</h2>");
    expect(html).toContain("<h2>process</h2>");
    expect(html).not.toContain(SENTINEL_PASSWORD);
  });

  it("the process fragment answers 500 with the reason, never echoing the password", async () => {
    const { status, html } = await getPage("/servers/process", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toBe("<p>error: internal error</p>");
    expect(html).not.toContain(SENTINEL_PASSWORD);
  });

  it("the fleet fragment answers 500 with the reason, never echoing the password", async () => {
    const { status, html } = await getPage("/servers/fleet", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toBe("<p>error: internal error</p>");
    expect(html).not.toContain(SENTINEL_PASSWORD);
  });

  it("the queue fragment answers 500 with the reason, never echoing the password", async () => {
    const { status, html } = await getPage("/servers/queue", REFUSED_URL);
    expect(status).toBe(500);
    expect(html).toBe("<p>error: internal error</p>");
    expect(html).not.toContain(SENTINEL_PASSWORD);
  });

  it("listAutomationQueue surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listAutomationQueue(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("adding and deleting answer 500 the same way", async () => {
    const added = await postForm({ url: "http://10.1.0.5:42069" }, REFUSED_URL, "/servers");
    expect(added.status).toBe(500);
    expect(added.text).toContain("<p>error: internal error</p>");
    expect(added.text).not.toContain(SENTINEL_PASSWORD);
    const deleted = await postForm(
      { url: "http://10.1.0.5:42069" },
      REFUSED_URL,
      "/servers/delete",
    );
    expect(deleted.status).toBe(500);
    expect(deleted.text).toContain("<p>error: internal error</p>");
    expect(deleted.text).not.toContain(SENTINEL_PASSWORD);
  });
});

const TOKEN = "test-token";
const LINEAR_TOKEN = "lin_api_test";
// The ids Linear answered for OLI-1448 and the Oligarchy team's Aborted status on 2026-09-14.
const ISSUE_ID = "3990cc5d-3e5f-44a3-ad3d-d2a5ed1fa2bc";
const ABORTED_STATE_ID = "2ec3c6a2-934b-4869-9aaf-bfe5d37e6fa4";
// Every url an abort may reach when the test does not stand one up: each refuses.
const REFUSED_HTTP = "http://127.0.0.1:1";

// Linear's two answers as its GraphQL sends them: the issue with its team's one state of that
// name, then the update's success. `states` scripts the first, `success` the second.
const linearAnswering = (
  states: ReadonlyArray<{ readonly id: string }> = [{ id: ABORTED_STATE_ID }],
  success = true,
): StubProxy.Script => {
  return (received) => {
    const text = JSON.stringify(received.body);
    if (text.includes("query AbortedState")) {
      return StubProxy.json(200, {
        data: { issue: { id: ISSUE_ID, team: { states: { nodes: states } } } },
      });
    }
    if (text.includes("mutation AbortIssue")) {
      return StubProxy.json(200, { data: { issueUpdate: { success } } });
    }
    return StubProxy.json(200, { errors: [{ message: "unexpected operation" }], data: null });
  };
};

// Linear's refusal of a ticket it does not know: 200 with errors beside a null data.
const linearNotFound: StubProxy.Script = () =>
  StubProxy.json(200, {
    errors: [{ message: "Entity not found: Issue", path: ["issue"] }],
    data: null,
  });

// The two requests the dashboard's abort makes of Linear for a ticket: the raw token in the
// authorization header (a personal API key takes no Bearer), the state asked by name, the
// update by the ids the first answer carried.
const linearMove = (ticket: string): ReadonlyArray<StubProxy.Received> => [
  {
    method: "POST",
    url: "/graphql",
    authorization: LINEAR_TOKEN,
    body: {
      query: expect.stringContaining("query AbortedState"),
      variables: { ticket, state: "Aborted" },
    },
  },
  {
    method: "POST",
    url: "/graphql",
    authorization: LINEAR_TOKEN,
    body: {
      query: expect.stringContaining("mutation AbortIssue"),
      variables: { id: ISSUE_ID, stateId: ABORTED_STATE_ID },
    },
  },
];

type AbortEnv = {
  readonly databaseUrl: string;
  readonly automationUrl: string;
  readonly linearUrl: string;
};

const abortBindings = (env: AbortEnv) => ({
  HYPERDRIVE: { connectionString: env.databaseUrl },
  OLIGARCHY_TOKEN: TOKEN,
  AUTOMATION_SERVER_URL: env.automationUrl,
  LINEAR_API_URL: `${env.linearUrl}/graphql`,
  LINEAR_API_TOKEN: LINEAR_TOKEN,
});

// The body names the row the way the page's form does: the ticket and the row's action.
const postAbort = async (
  ticket: string,
  env: AbortEnv,
  action: QueuedJob["action"] = "drive",
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const response = await app.request(
    "/abort",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket, action }),
    },
    abortBindings(env),
  );
  return { status: response.status, body: await response.json() };
};

const jobByTicket = async (
  databaseUrl: string,
  ticket: string,
  action: QueuedJob["action"] = "drive",
): Promise<{
  readonly status: string;
  readonly reason: string | null;
  readonly finishedAt: Date | null;
}> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [row] = await drizzle(client)
      .select({
        status: automationJobs.status,
        reason: automationJobs.reason,
        finishedAt: automationJobs.finishedAt,
      })
      .from(automationJobs)
      .innerJoin(testResults, eq(testResults.id, automationJobs.resultId))
      .where(and(eq(testResults.linearId, ticket), eq(automationJobs.action, action)));
    if (row === undefined) {
      throw new Error(`no ${action} job for ${ticket}`);
    }
    return row;
  } finally {
    await client.end();
  }
};

// One ticket with both of its jobs: the drive running, the diagnose queued behind it, the state a
// ticket is in between the driver moving it to Needs Review and the drive closing. seedQueue gives
// every job its own result, so this pair is seeded onto one.
const seedSiblings = async (db: NodePgDatabase, name: string, ticket: string): Promise<void> => {
  await db.delete(automationJobs);
  const [definition] = await db
    .insert(testDefinitions)
    .values({ name, description: "d", instruction: "i", proof: "p" })
    .returning({ id: testDefinitions.id });
  const [run] = await db
    .insert(testRuns)
    .values({ name, iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" })
    .returning({ id: testRuns.id });
  const [result] = await db
    .insert(testResults)
    .values({ runId: run.id, definitionId: definition.id, linearId: ticket })
    .returning({ id: testResults.id });
  await db.insert(automationJobs).values([
    {
      resultId: result.id,
      action: "drive",
      status: "running",
      createdAt: secondsAgo(300),
      startedAt: secondsAgo(200),
    },
    { resultId: result.id, action: "diagnose", status: "pending", createdAt: secondsAgo(20) },
  ]);
};

const runningJob = (ticket: string): QueuedJob => ({
  ticket,
  action: "drive",
  status: "running",
  queuedSecondsAgo: 10,
  startedSecondsAgo: 5,
});

const pendingJob = (ticket: string): QueuedJob => ({
  ticket,
  action: "drive",
  status: "pending",
  queuedSecondsAgo: 10,
});

const finishedJob = (ticket: string): QueuedJob => ({
  ticket,
  action: "drive",
  status: "succeeded",
  queuedSecondsAgo: 30,
  startedSecondsAgo: 20,
  finishedSecondsAgo: 5,
});

describe.skipIf(dbUrl === "")("dashboard/query abortAutomationJob happy path", () => {
  it("closes a running job for the ticket from running and ends the connection", async () => {
    await seed(dbUrl, (db) => seedQueue(db, "abort-query-running", [runningJob("ABT-Q-1")]));
    const result = await runQuery(
      'const closed = await query.abortAutomationJob(url, "ABT-Q-1", "drive", "running");\nconsole.log(String(closed));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("true\n");
    const job = await jobByTicket(dbUrl, "ABT-Q-1");
    expect(job.status).toBe("aborted");
    expect(job.reason).toBe("aborted");
    expect(job.finishedAt).toBeInstanceOf(Date);
  });

  it("closes the one row named by ticket and action when the ticket has a running drive and a pending diagnose", async () => {
    await seed(dbUrl, (db) => seedSiblings(db, "abort-query-siblings", "ABT-Q-SIB"));
    const result = await runQuery(
      'console.log(String(await query.abortAutomationJob(url, "ABT-Q-SIB", "drive", "pending")));\nconsole.log(String(await query.abortAutomationJob(url, "ABT-Q-SIB", "diagnose", "pending")));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("false\ntrue\n");
    expect((await jobByTicket(dbUrl, "ABT-Q-SIB", "drive")).status).toBe("running");
    expect((await jobByTicket(dbUrl, "ABT-Q-SIB", "diagnose")).status).toBe("aborted");
  });

  it("closes a pending job for the ticket from pending, its finish stamped, and ends the connection", async () => {
    await seed(dbUrl, (db) => seedQueue(db, "abort-query-pending", [pendingJob("ABT-Q-P")]));
    const result = await runQuery(
      'const closed = await query.abortAutomationJob(url, "ABT-Q-P", "drive", "pending");\nconsole.log(String(closed));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("true\n");
    const job = await jobByTicket(dbUrl, "ABT-Q-P");
    expect(job.status).toBe("aborted");
    expect(job.reason).toBe("aborted");
    expect(job.finishedAt).toBeInstanceOf(Date);
  });
});

describe.skipIf(dbUrl === "")("dashboard/query abortAutomationJob unhappy path", () => {
  it("leaves a pending job pending when asked to close it from running, and ends the connection", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "abort-query-pending-as-running", [pendingJob("ABT-Q-2")]),
    );
    const result = await runQuery(
      'const closed = await query.abortAutomationJob(url, "ABT-Q-2", "drive", "running");\nconsole.log(String(closed));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("false\n");
    expect(await jobByTicket(dbUrl, "ABT-Q-2")).toMatchObject({
      status: "pending",
      reason: null,
      finishedAt: null,
    });
  });

  it("leaves a running job running when asked to close it from pending, and ends the connection", async () => {
    await seed(dbUrl, (db) =>
      seedQueue(db, "abort-query-running-as-pending", [runningJob("ABT-Q-4")]),
    );
    const result = await runQuery(
      'const closed = await query.abortAutomationJob(url, "ABT-Q-4", "drive", "pending");\nconsole.log(String(closed));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("false\n");
    expect(await jobByTicket(dbUrl, "ABT-Q-4")).toMatchObject({
      status: "running",
      reason: null,
      finishedAt: null,
    });
  });

  it("leaves a finished job finished from either, and ends the connection", async () => {
    await seed(dbUrl, (db) => seedQueue(db, "abort-query-done", [finishedJob("ABT-Q-3")]));
    const result = await runQuery(
      'console.log(String(await query.abortAutomationJob(url, "ABT-Q-3", "drive", "running")));\nconsole.log(String(await query.abortAutomationJob(url, "ABT-Q-3", "drive", "pending")));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("false\nfalse\n");
    expect((await jobByTicket(dbUrl, "ABT-Q-3")).status).toBe("succeeded");
  });

  it("returns false for an unknown ticket and ends the connection", async () => {
    const result = await runQuery(
      'console.log(String(await query.abortAutomationJob(url, "ABT-missing", "drive", "running")));\nconsole.log(String(await query.abortAutomationJob(url, "ABT-missing", "drive", "pending")));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("false\nfalse\n");
  });
});

describe("dashboard POST /abort happy path: the outbound calls", () => {
  it("posts a form ticket the same way the servers page abort button does", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      const response = await app.request(
        "/abort",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ticket: "ABT-FORM", action: "drive" }).toString(),
        },
        abortBindings({
          databaseUrl: REFUSED_URL,
          automationUrl: proxy.url,
          linearUrl: linear.url,
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/servers");
      expect(proxy.requests).toEqual([
        {
          method: "POST",
          url: "/abort",
          authorization: `Bearer ${TOKEN}`,
          body: { ticket: "ABT-FORM", action: "drive" },
        },
      ]);
      expect(linear.requests).toEqual(linearMove("ABT-FORM"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("posts a definitions-page abort the same way, and returns to that definition", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      const response = await app.request(
        "/abort",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ticket: "ABT-FORM-DEF",
            action: "drive",
            view: "definitions",
            definition: "lock-screen",
          }).toString(),
        },
        abortBindings({
          databaseUrl: REFUSED_URL,
          automationUrl: proxy.url,
          linearUrl: linear.url,
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/definitions?name=lock-screen");
      expect(proxy.requests).toEqual([
        {
          method: "POST",
          url: "/abort",
          authorization: `Bearer ${TOKEN}`,
          body: { ticket: "ABT-FORM-DEF", action: "drive" },
        },
      ]);
      expect(linear.requests).toEqual(linearMove("ABT-FORM-DEF"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("posts the ticket with the bearer, moves the ticket to Aborted once the automation server answers 200, and answers 200", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      const response = await postAbort("ABT-200", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(proxy.requests).toEqual([
        {
          method: "POST",
          url: "/abort",
          authorization: `Bearer ${TOKEN}`,
          body: { ticket: "ABT-200", action: "drive" },
        },
      ]);
      expect(linear.requests).toEqual(linearMove("ABT-200"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

describe.skipIf(dbUrl === "")("dashboard POST /abort happy path", () => {
  it("leaves a running job running when the automation server answers 200, and moves the ticket", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-200", [runningJob("ABT-200")]));
      const response = await postAbort("ABT-200", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(proxy.requests).toEqual([
        {
          method: "POST",
          url: "/abort",
          authorization: `Bearer ${TOKEN}`,
          body: { ticket: "ABT-200", action: "drive" },
        },
      ]);
      expect((await jobByTicket(dbUrl, "ABT-200")).status).toBe("running");
      expect(linear.requests).toEqual(linearMove("ABT-200"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("closes a pending job here without asking the automation server, then moves the ticket", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-pending", [pendingJob("ABT-PEND")]));
      const response = await postAbort("ABT-PEND", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      const job = await jobByTicket(dbUrl, "ABT-PEND");
      expect(job.status).toBe("aborted");
      expect(job.reason).toBe("aborted");
      expect(job.finishedAt).toBeInstanceOf(Date);
      expect(proxy.requests).toEqual([]);
      expect(linear.requests).toEqual(linearMove("ABT-PEND"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("aborts only the pending diagnose of a ticket whose drive is running, asking the automation server nothing", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedSiblings(db, "abort-sibling-diagnose", "ABT-SIB-1"));
      const response = await postAbort(
        "ABT-SIB-1",
        { databaseUrl: dbUrl, automationUrl: proxy.url, linearUrl: linear.url },
        "diagnose",
      );
      expect(response.status).toBe(200);
      expect((await jobByTicket(dbUrl, "ABT-SIB-1", "diagnose")).status).toBe("aborted");
      expect((await jobByTicket(dbUrl, "ABT-SIB-1", "drive")).status).toBe("running");
      expect(proxy.requests).toEqual([]);
      expect(linear.requests).toEqual(linearMove("ABT-SIB-1"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("aborts only the running drive of a ticket whose diagnose is pending, through the automation server", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedSiblings(db, "abort-sibling-drive", "ABT-SIB-2"));
      const response = await postAbort(
        "ABT-SIB-2",
        { databaseUrl: dbUrl, automationUrl: proxy.url, linearUrl: linear.url },
        "drive",
      );
      expect(response.status).toBe(200);
      expect(proxy.requests).toEqual([
        {
          method: "POST",
          url: "/abort",
          authorization: `Bearer ${TOKEN}`,
          body: { ticket: "ABT-SIB-2", action: "drive" },
        },
      ]);
      expect((await jobByTicket(dbUrl, "ABT-SIB-2", "diagnose")).status).toBe("pending");
      expect((await jobByTicket(dbUrl, "ABT-SIB-2", "drive")).status).toBe("running");
      expect(linear.requests).toEqual(linearMove("ABT-SIB-2"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("leaves the running drive alone when the pending diagnose it already closed is aborted again", async () => {
    // The automation server refuses the second post as the real one does: the ticket's running
    // job is its drive, not the diagnose named.
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-SIB-3" is running a drive, not a diagnose'),
    );
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedSiblings(db, "abort-sibling-again", "ABT-SIB-3"));
      const env = { databaseUrl: dbUrl, automationUrl: proxy.url, linearUrl: linear.url };
      expect((await postAbort("ABT-SIB-3", env, "diagnose")).status).toBe(200);
      expect((await postAbort("ABT-SIB-3", env, "diagnose")).status).toBe(200);
      expect((await jobByTicket(dbUrl, "ABT-SIB-3", "diagnose")).status).toBe("aborted");
      expect((await jobByTicket(dbUrl, "ABT-SIB-3", "drive")).status).toBe("running");
      expect(proxy.requests).toEqual([
        {
          method: "POST",
          url: "/abort",
          authorization: `Bearer ${TOKEN}`,
          body: { ticket: "ABT-SIB-3", action: "diagnose" },
        },
      ]);
      expect(linear.requests).toEqual(linearMove("ABT-SIB-3"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers the queue fragment with the pending job under completed as aborted when htmx asks", async () => {
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) =>
        seedQueue(db, "abort-htmx-pending", [pendingJob("ABT-HX-1"), pendingJob("ABT-HX-2")]),
      );
      const response = await app.request(
        "/abort",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "hx-request": "true",
          },
          body: new URLSearchParams({ ticket: "ABT-HX-1", action: "drive" }).toString(),
        },
        abortBindings({ databaseUrl: dbUrl, automationUrl: REFUSED_HTTP, linearUrl: linear.url }),
      );
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html.startsWith("<h3>running</h3><p>none</p><h3>pending</h3><table>")).toBe(true);
      expect(html).toMatch(
        /<h3>pending<\/h3><table>.*?<td>ABT-HX-2<\/td>.*?<h3>completed<\/h3><table>.*?<tr><td>ABT-HX-1<\/td><td>abort-htmx-pending<\/td><td>drive<\/td><td>aborted<\/td><td>\d+ s ago<\/td><td>—<\/td><td>\d+ s ago<\/td><td>aborted<\/td><td><\/td><\/tr>/s,
      );
      expect(linear.requests).toEqual(linearMove("ABT-HX-1"));
    } finally {
      await linear.close();
    }
  });

  it("answers the running list with the stopped job gone when the definitions page aborts it", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.refusal(500, "opencode exited 1"));
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) =>
        seedQueue(db, "abort-definitions", [
          runningJob("ABT-DEF-STOP"),
          runningJob("ABT-DEF-KEEP"),
        ]),
      );
      const response = await app.request(
        "/abort",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "hx-request": "true",
          },
          body: new URLSearchParams({
            ticket: "ABT-DEF-STOP",
            action: "drive",
            view: "definitions",
            definition: "abort-definitions",
          }).toString(),
        },
        abortBindings({ databaseUrl: dbUrl, automationUrl: proxy.url, linearUrl: linear.url }),
      );
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html.startsWith('<ol class="running-tests__list">')).toBe(true);
      expect(html).toContain(definitionsAbortForm("ABT-DEF-KEEP", "drive", "abort-definitions"));
      expect(html).not.toContain("ABT-DEF-STOP");
      expect(html).not.toContain("<h3>running</h3>");
      expect((await jobByTicket(dbUrl, "ABT-DEF-STOP")).status).toBe("aborted");
      expect((await jobByTicket(dbUrl, "ABT-DEF-KEEP")).status).toBe("running");
      expect(linear.requests).toEqual(linearMove("ABT-DEF-STOP"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

describe("dashboard POST /abort unhappy path: always 200", () => {
  it("does nothing for a body whose action is missing or not one a job has", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      for (const body of [{ ticket: "ABT-NOACT" }, { ticket: "ABT-NOACT", action: "reboot" }]) {
        const response = await app.request(
          "/abort",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
          abortBindings({
            databaseUrl: REFUSED_URL,
            automationUrl: proxy.url,
            linearUrl: linear.url,
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: "true" });
      }
      expect(proxy.requests).toEqual([]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 when the automation server returns 400 and the database is unreachable, asking Linear nothing", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-400" is not running'),
    );
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      const response = await postAbort("ABT-400", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers the queue error fragment when htmx asks and the database is unreachable", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "hx-request": "true",
        },
        body: "",
      },
      abortBindings({
        databaseUrl: REFUSED_URL,
        automationUrl: REFUSED_HTTP,
        linearUrl: REFUSED_HTTP,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>error: internal error</p>");
  });

  it("answers the running-list error when the definitions page asks and the database is unreachable", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "hx-request": "true",
        },
        body: new URLSearchParams({ view: "definitions", definition: "lock-screen" }).toString(),
      },
      abortBindings({
        databaseUrl: REFUSED_URL,
        automationUrl: REFUSED_HTTP,
        linearUrl: REFUSED_HTTP,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>error: internal error</p>");
    expect(response.headers.get("location")).toBeNull();
  });

  it("answers 200 when the automation server is unreachable and the database is too", async () => {
    const response = await postAbort("ABT-DOWN", {
      databaseUrl: REFUSED_URL,
      automationUrl: REFUSED_HTTP,
      linearUrl: REFUSED_HTTP,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: "true" });
  });

  it("answers 200 when the automation server accepts the request and never answers", async () => {
    const server = createHttpServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("hanging abort server: no tcp address");
      }
      const response = await postAbort("ABT-HANG", {
        databaseUrl: REFUSED_URL,
        automationUrl: `http://127.0.0.1:${String(address.port)}`,
        linearUrl: REFUSED_HTTP,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("answers 200 when the job closed and Linear is unreachable", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      const response = await postAbort("ABT-LIN-DOWN", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: REFUSED_HTTP,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(proxy.requests).toHaveLength(1);
    } finally {
      await proxy.close();
    }
  });

  it("answers 200 when the job closed and Linear accepts the request and never answers", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const server = createHttpServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("hanging linear server: no tcp address");
      }
      const response = await postAbort("ABT-LIN-HANG", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: `http://127.0.0.1:${String(address.port)}`,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
    } finally {
      await proxy.close();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("answers 200 and stops after the first request when Linear does not know the ticket", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearNotFound);
    try {
      const response = await postAbort("ABT-LIN-404", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(linear.requests).toEqual([linearMove("ABT-LIN-404")[0]]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 and stops after the first request when the ticket's team has no Aborted status", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAnswering([]));
    try {
      const response = await postAbort("ABT-LIN-NOSTATE", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(linear.requests).toEqual([linearMove("ABT-LIN-NOSTATE")[0]]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 when Linear refuses the token with a 401", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(() =>
      StubProxy.json(401, { errors: [{ message: "Authentication required, not authenticated" }] }),
    );
    try {
      const response = await postAbort("ABT-LIN-401", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(linear.requests).toHaveLength(1);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 when Linear answers the update with success false", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(
      linearAnswering([{ id: ABORTED_STATE_ID }], false),
    );
    try {
      const response = await postAbort("ABT-LIN-FALSE", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(linear.requests).toEqual(linearMove("ABT-LIN-FALSE"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

describe.skipIf(dbUrl === "")("dashboard POST /abort unhappy path", () => {
  it("answers 200, marks a running job aborted and moves the ticket when the automation server returns 400", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-400" is not running'),
    );
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-400", [runningJob("ABT-400")]));
      const response = await postAbort("ABT-400", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      const job = await jobByTicket(dbUrl, "ABT-400");
      expect(job.status).toBe("aborted");
      expect(job.reason).toBe("aborted");
      expect(linear.requests).toEqual(linearMove("ABT-400"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200, marks a running job aborted and moves the ticket when the automation server returns 500", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.refusal(500, "opencode exited 1"));
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-500", [runningJob("ABT-500")]));
      const response = await postAbort("ABT-500", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-500")).status).toBe("aborted");
      expect(linear.requests).toEqual(linearMove("ABT-500"));
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200, marks a running job aborted and moves the ticket when the automation server is unreachable", async () => {
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-down", [runningJob("ABT-DOWN")]));
      const response = await postAbort("ABT-DOWN", {
        databaseUrl: dbUrl,
        automationUrl: REFUSED_HTTP,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-DOWN")).status).toBe("aborted");
      expect(linear.requests).toEqual(linearMove("ABT-DOWN"));
    } finally {
      await linear.close();
    }
  });

  it("answers 200 and leaves a pending job aborted when Linear then refuses the move", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearNotFound);
    try {
      await seed(dbUrl, (db) =>
        seedQueue(db, "abort-http-pending-lin", [pendingJob("ABT-PEND-LIN")]),
      );
      const response = await postAbort("ABT-PEND-LIN", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-PEND-LIN")).status).toBe("aborted");
      expect(proxy.requests).toEqual([]);
      expect(linear.requests).toHaveLength(1);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200, leaves a finished job finished and moves nothing when the automation server returns 400", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-DONE" is not running'),
    );
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-done", [finishedJob("ABT-DONE")]));
      const response = await postAbort("ABT-DONE", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-DONE")).status).toBe("succeeded");
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 and moves nothing for a ticket no job carries", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-NOBODY" is not running'),
    );
    const linear = await StubProxy.startStubProxy(linearAnswering());
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-nobody", [pendingJob("ABT-OTHER")]));
      const response = await postAbort("ABT-NOBODY", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-OTHER")).status).toBe("pending");
      expect(proxy.requests).toHaveLength(1);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

// A stamp some days before the database's clock, the clock the sweep's cutoff is read from.
const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`;

const CRON = { cron: "0 4 * * *" };
const SWEEP =
  "const deleted = await query.deleteOldRows(url);\nconsole.log(JSON.stringify(deleted));";

// The ids the sweep is measured by afterwards: one session's tree, the run whose result it ran,
// and the tag naming the rows keyed by text.
type Aged = {
  readonly tag: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly imageActionId: number;
  readonly runId: string;
  readonly resultId: string;
};

// Everything the sweep reads an age off, `days` old: a session with its agent, two actions, the
// image of the last, its debug log, its diagnosis and its route; a run whose one result the
// session ran, with the job that drove it; a log line, a process reading and the agent's
// reservation. Beside them, of the same age, the configuration the sweep must leave: the
// definition the result pinned, the error type the diagnosis names, and a server.
const seedAged = async (db: NodePgDatabase, tag: string, days: number): Promise<Aged> => {
  const at = daysAgo(days);
  const sessionId = randomUUID();
  const agentId = `PRUNE-${tag}`;
  const url = `http://prune-${tag}:42069`;
  await db.insert(sessions).values({
    id: sessionId,
    config: { iso: "x" },
    status: "succeeded",
    startedAt: at,
    endedAt: at,
  });
  await db.insert(agentRuns).values({ agentId, sessionId, startedAt: at, endedAt: at });
  const [, last] = await db
    .insert(actions)
    .values([
      { sessionId, agentId, request: { name: "click" }, state: "completed", createdAt: at },
      { sessionId, agentId, request: { name: "screenshot" }, state: "completed", createdAt: at },
    ])
    .returning({ id: actions.id });
  await db.insert(images).values({ actionId: last.id, data: Buffer.from("png") });
  await db.insert(debugLogs).values({
    sessionId,
    sources: { serial: "", proxy: "", qemu: "", actions: "" },
    createdAt: at,
  });
  await db
    .insert(postRunErrorTypes)
    .values({ key: `prune-${tag}`, description: "d", createdAt: at });
  await db.insert(postRunDiagnosis).values({
    sessionId,
    verdict: "failed",
    errorType: `prune-${tag}`,
    summary: "s",
    model: "m",
    createdAt: at,
  });
  await db.insert(sessionServers).values({ sessionId, serverUrl: url, createdAt: at });
  const [definition] = await db
    .insert(testDefinitions)
    .values({ name: `prune-${tag}`, description: "d", instruction: "i", proof: "p", createdAt: at })
    .returning({ id: testDefinitions.id });
  const [run] = await db
    .insert(testRuns)
    .values({
      name: `prune ${tag}`,
      iso: "https://example.com/omarchy.iso",
      serverUrl: url,
      status: "passed",
      startedAt: at,
      endedAt: at,
    })
    .returning({ id: testRuns.id });
  const [result] = await db
    .insert(testResults)
    .values({
      runId: run.id,
      definitionId: definition.id,
      sessionId,
      model: "m",
      linearId: agentId,
      status: "passed",
      createdAt: at,
      finishedAt: at,
    })
    .returning({ id: testResults.id });
  await db.insert(automationJobs).values({
    resultId: result.id,
    action: "drive",
    status: "succeeded",
    createdAt: at,
    startedAt: at,
    finishedAt: at,
  });
  await db.insert(logs).values({ location: sessionId, agentId, text: "line", createdAt: at });
  await db.insert(processStats).values({
    name: `prune-${tag}`,
    type: "qemu",
    jobs: 0,
    memoryBytes: 0,
    cpuPercent: 0,
    reportedAt: at,
  });
  await db.insert(agentServers).values({ agentId, serverUrl: url, createdAt: at });
  await db.insert(servers).values({ url, createdAt: at });
  return { tag, sessionId, agentId, imageActionId: last.id, runId: run.id, resultId: result.id };
};

type AgedRows = {
  readonly sessions: number;
  readonly agentRuns: number;
  readonly actions: number;
  readonly images: number;
  readonly debugLogs: number;
  readonly postRunDiagnosis: number;
  readonly sessionServers: number;
  readonly testRuns: number;
  readonly testResults: number;
  readonly automationJobs: number;
  readonly logs: number;
  readonly processStats: number;
  readonly agentServers: number;
  readonly testDefinitions: number;
  readonly postRunErrorTypes: number;
  readonly servers: number;
};

// What is left of one seedAged, table by table.
const remaining = async (db: NodePgDatabase, aged: Aged): Promise<AgedRows> => ({
  sessions: await db.$count(sessions, eq(sessions.id, aged.sessionId)),
  agentRuns: await db.$count(agentRuns, eq(agentRuns.agentId, aged.agentId)),
  actions: await db.$count(actions, eq(actions.sessionId, aged.sessionId)),
  images: await db.$count(images, eq(images.actionId, aged.imageActionId)),
  debugLogs: await db.$count(debugLogs, eq(debugLogs.sessionId, aged.sessionId)),
  postRunDiagnosis: await db.$count(
    postRunDiagnosis,
    eq(postRunDiagnosis.sessionId, aged.sessionId),
  ),
  sessionServers: await db.$count(sessionServers, eq(sessionServers.sessionId, aged.sessionId)),
  testRuns: await db.$count(testRuns, eq(testRuns.id, aged.runId)),
  testResults: await db.$count(testResults, eq(testResults.runId, aged.runId)),
  automationJobs: await db.$count(automationJobs, eq(automationJobs.resultId, aged.resultId)),
  logs: await db.$count(logs, eq(logs.agentId, aged.agentId)),
  processStats: await db.$count(processStats, eq(processStats.name, `prune-${aged.tag}`)),
  agentServers: await db.$count(agentServers, eq(agentServers.agentId, aged.agentId)),
  testDefinitions: await db.$count(testDefinitions, eq(testDefinitions.name, `prune-${aged.tag}`)),
  postRunErrorTypes: await db.$count(
    postRunErrorTypes,
    eq(postRunErrorTypes.key, `prune-${aged.tag}`),
  ),
  servers: await db.$count(servers, eq(servers.url, `http://prune-${aged.tag}:42069`)),
});

const SEEDED: AgedRows = {
  sessions: 1,
  agentRuns: 1,
  actions: 2,
  images: 1,
  debugLogs: 1,
  postRunDiagnosis: 1,
  sessionServers: 1,
  testRuns: 1,
  testResults: 1,
  automationJobs: 1,
  logs: 1,
  processStats: 1,
  agentServers: 1,
  testDefinitions: 1,
  postRunErrorTypes: 1,
  servers: 1,
};

// Swept: every row with an age gone, the configuration as it was.
const SWEPT: AgedRows = {
  ...SEEDED,
  sessions: 0,
  agentRuns: 0,
  actions: 0,
  images: 0,
  debugLogs: 0,
  postRunDiagnosis: 0,
  sessionServers: 0,
  testRuns: 0,
  testResults: 0,
  automationJobs: 0,
  logs: 0,
  processStats: 0,
  agentServers: 0,
};

// A run that started `runDays` ago with one result attributed to a plain session started
// `sessionDays` ago; the ids the sweep is measured by afterwards.
const seedLinked = async (
  db: NodePgDatabase,
  tag: string,
  runDays: number,
  sessionDays: number,
): Promise<{ readonly sessionId: string; readonly runId: string; readonly resultId: string }> => {
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    config: { iso: "x" },
    status: "succeeded",
    startedAt: daysAgo(sessionDays),
  });
  const [definition] = await db
    .insert(testDefinitions)
    .values({ name: `prune-${tag}`, description: "d", instruction: "i", proof: "p" })
    .returning({ id: testDefinitions.id });
  const [run] = await db
    .insert(testRuns)
    .values({
      name: `prune ${tag}`,
      iso: "https://example.com/omarchy.iso",
      serverUrl: "http://127.0.0.1:42069",
      startedAt: daysAgo(runDays),
    })
    .returning({ id: testRuns.id });
  const [result] = await db
    .insert(testResults)
    .values({
      runId: run.id,
      definitionId: definition.id,
      sessionId,
      status: "passed",
      model: "m",
      linearId: `PRUNE-${tag}`,
    })
    .returning({ id: testResults.id });
  await db
    .insert(automationJobs)
    .values({ resultId: result.id, action: "drive", status: "succeeded" });
  return { sessionId, runId: run.id, resultId: result.id };
};

// The first test sweeps a database with no other row past the cutoff, so its counts are exact;
// the ones after it match on the rows they seeded.
describe.skipIf(dbUrl === "")("dashboard/query deleteOldRows happy path", () => {
  it("deletes every row older than thirty days with what hangs off it, keeps younger rows and the configuration, counts what went, and ends the connection", async () => {
    const { old, kept } = await seed(dbUrl, async (db) => ({
      old: await seedAged(db, "old", 31),
      kept: await seedAged(db, "kept", 29),
    }));
    const result = await runQuery(SWEEP, dbUrl);
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      automationJobs: 1,
      testResults: 1,
      testRuns: 1,
      images: 1,
      actions: 2,
      agentRuns: 1,
      debugLogs: 1,
      postRunDiagnosis: 1,
      sessionServers: 1,
      sessions: 1,
      logs: 1,
      processStats: 1,
      agentServers: 1,
    });
    const rows = await seed(dbUrl, async (db) => ({
      old: await remaining(db, old),
      kept: await remaining(db, kept),
    }));
    expect(rows.old).toEqual(SWEPT);
    expect(rows.kept).toEqual(SEEDED);
  });

  it("takes an old run's results and jobs with it and leaves the younger session one of them ran", async () => {
    const linked = await seed(dbUrl, (db) => seedLinked(db, "late", 31, 1));
    const result = await runQuery(SWEEP, dbUrl);
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      automationJobs: 1,
      testResults: 1,
      testRuns: 1,
      sessions: 0,
    });
    const left = await seed(dbUrl, async (db) => ({
      testRuns: await db.$count(testRuns, eq(testRuns.id, linked.runId)),
      testResults: await db.$count(testResults, eq(testResults.id, linked.resultId)),
      sessions: await db.$count(sessions, eq(sessions.id, linked.sessionId)),
    }));
    expect(left).toEqual({ testRuns: 0, testResults: 0, sessions: 1 });
  });

  it("runs as the Worker's scheduled handler: the old rows go and the cron resolves", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(logs).values([
        { location: "server", agentId: "PRUNE-cron", text: "old", createdAt: daysAgo(31) },
        { location: "server", agentId: "PRUNE-cron", text: "kept", createdAt: daysAgo(29) },
      ]);
    });
    await expect(
      scheduled(
        CRON,
        abortBindings({
          databaseUrl: dbUrl,
          automationUrl: REFUSED_HTTP,
          linearUrl: REFUSED_HTTP,
        }),
      ),
    ).resolves.toBeUndefined();
    const texts = await seed(dbUrl, (db) =>
      db.select({ text: logs.text }).from(logs).where(eq(logs.agentId, "PRUNE-cron")),
    );
    expect(texts).toEqual([{ text: "kept" }]);
  });
});

describe.skipIf(dbUrl === "")("dashboard/query deleteOldRows unhappy path", () => {
  it("deletes nothing when one delete is refused, and the next sweep takes the rows once the refusal is gone", async () => {
    // A young run's result on an old session: nothing writes this, and the session's own delete
    // is refused by the foreign key. The whole sweep rolls back, the session's actions included.
    const held = await seed(dbUrl, async (db) => {
      const linked = await seedLinked(db, "held", 1, 31);
      await db.insert(actions).values({
        sessionId: linked.sessionId,
        request: { name: "click" },
        createdAt: daysAgo(31),
      });
      return linked;
    });
    const refused = await runQuery(
      "try {\n  await query.deleteOldRows(url);\n} catch (err) {\n  console.error(`${err.message}: ${err.cause.message}`);\n  process.exitCode = 3;\n}",
      dbUrl,
    );
    expect(refused.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(refused.code).toBe(3);
    expect(refused.stderr).toMatch(/Failed query: delete from "sessions"/);
    expect(refused.stderr).toMatch(/violates foreign key constraint/);
    const untouched = await seed(dbUrl, async (db) => ({
      actions: await db.$count(actions, eq(actions.sessionId, held.sessionId)),
      sessions: await db.$count(sessions, eq(sessions.id, held.sessionId)),
    }));
    expect(untouched).toEqual({ actions: 1, sessions: 1 });

    await seed(dbUrl, async (db) => {
      await db.delete(automationJobs).where(eq(automationJobs.resultId, held.resultId));
      await db.delete(testResults).where(eq(testResults.id, held.resultId));
      await db.delete(testRuns).where(eq(testRuns.id, held.runId));
    });
    const swept = await runQuery(SWEEP, dbUrl);
    expect(swept.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(swept.stderr).toBe("");
    expect(swept.code).toBe(0);
    expect(JSON.parse(swept.stdout)).toMatchObject({ sessions: 1, actions: 1 });
    const gone = await seed(dbUrl, async (db) => ({
      actions: await db.$count(actions, eq(actions.sessionId, held.sessionId)),
      sessions: await db.$count(sessions, eq(sessions.id, held.sessionId)),
    }));
    expect(gone).toEqual({ actions: 0, sessions: 0 });
  });
});

describe("dashboard/query deleteOldRows unhappy path: unreachable database", () => {
  it("surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.deleteOldRows(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  // The cron's failure is thrown, so Cloudflare records the event as failed and Sentry's wrapper
  // reports it; the connection string never reaches the message.
  it("the scheduled handler rejects with the refused connection, without echoing the password", async () => {
    const outcome = await scheduled(
      CRON,
      abortBindings({
        databaseUrl: REFUSED_URL,
        automationUrl: REFUSED_HTTP,
        linearUrl: REFUSED_HTTP,
      }),
    ).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(outcome).toMatch(/ECONNREFUSED/);
    expect(outcome).not.toContain(SENTINEL_PASSWORD);
  });
});
