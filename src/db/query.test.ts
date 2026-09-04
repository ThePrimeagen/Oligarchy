import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const QUERY = resolve(import.meta.dirname, "query.ts");
const REFUSED_URL = "postgres://user:pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 15_000;

// Each call runs in its own process and the script never calls process.exit: a pg client
// that is not ended keeps the event loop alive, so the process exiting on its own is the
// proof that end() ran, on success and on failure alike.
async function runQuery(script: string, databaseUrl: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  hung: boolean;
}> {
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
  const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
  clearTimeout(timer);
  return { code, stdout, stderr, hung: signal === "SIGKILL" };
}

// The dashboard hands query.ts Hyperdrive's connection string, which carries no
// sslrootcert. PlanetScale's DATABASE_URL does (sslrootcert=system), and node-postgres reads
// that as a file path, so the test drops it the way ops.ts does for the proxy.
function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  assert.ok(url !== undefined && url !== "", "DATABASE_URL must be set for the query tests");
  const parsed = new URL(url);
  parsed.searchParams.delete("sslrootcert");
  return parsed.toString();
}

describe("db/query happy path", () => {
  it("answers a query and ends the connection so the process exits on its own", async () => {
    const result = await runQuery(
      "const rows = await query.listTestDefinitions(url);\nconsole.log(JSON.stringify(rows.map((row) => row.name)));",
      databaseUrl(),
    );
    assert.equal(result.hung, false, "process did not exit: the pg client was not ended");
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    const names = JSON.parse(result.stdout) as string[];
    assert.ok(Array.isArray(names));
    assert.ok(names.includes("lock-screen"));
  });

  it("lists sessions with their latest image id and ends the connection", async () => {
    const result = await runQuery(
      "const rows = await query.listSessions(url);\nconsole.log(JSON.stringify(rows.map((row) => [typeof row.id, typeof row.status, row.imageId === null || typeof row.imageId, row.queriedAt instanceof Date])));",
      databaseUrl(),
    );
    assert.equal(result.hung, false, "process did not exit: the pg client was not ended");
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    const rows = JSON.parse(result.stdout) as [string, string, true | string, boolean][];
    assert.ok(rows.length <= 50);
    for (const [id, status, imageId, queriedAtIsDate] of rows) {
      assert.equal(id, "string");
      assert.equal(status, "string");
      assert.ok(imageId === true || imageId === "string");
      assert.equal(queriedAtIsDate, true);
    }
  });

  it("lists base prompts and ends the connection", async () => {
    const result = await runQuery(
      "const rows = await query.listTestBasePrompts(url);\nconsole.log(JSON.stringify(rows.map((row) => [typeof row.name, typeof row.prompt])));",
      databaseUrl(),
    );
    assert.equal(result.hung, false, "process did not exit: the pg client was not ended");
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    const rows = JSON.parse(result.stdout) as [string, string][];
    for (const [name, prompt] of rows) {
      assert.equal(name, "string");
      assert.equal(prompt, "string");
    }
  });

  it("returns undefined for an unknown image id and still exits", async () => {
    const result = await runQuery(
      'const image = await query.getImage(url, "00000000-0000-4000-8000-000000000000");\nconsole.log(String(image));',
      databaseUrl(),
    );
    assert.equal(result.hung, false, "process did not exit: the pg client was not ended");
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "undefined\n");
  });
});

describe("db/query unhappy path", () => {
  it("surfaces the Postgres error from a failed query and still ends the connection", async () => {
    const result = await runQuery(
      'try {\n  await query.getImage(url, "not-a-uuid");\n} catch (err) {\n  console.error(`${err.message}: ${err.cause.message}`);\n  process.exitCode = 3;\n}',
      databaseUrl(),
    );
    assert.equal(result.hung, false, "process did not exit: the pg client was not ended after the failed query");
    assert.equal(result.code, 3);
    assert.match(result.stderr, /Failed query: select "data"/);
    assert.match(result.stderr, /invalid input syntax for type uuid/);
  });

  it("surfaces a refused connection and exits", async () => {
    const result = await runQuery(
      "try {\n  await query.listTestDefinitions(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    assert.equal(result.hung, false);
    assert.equal(result.code, 3);
    assert.match(result.stderr, /ECONNREFUSED/);
  });
});
