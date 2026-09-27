import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const ADMIN = inject("postgresUrl");
const PASSWORD = "pa55w0rd-sentinel";

const rows = async (url: string, text: string): Promise<Array<Record<string, unknown>>> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
};

const freshDatabase = async (): Promise<string> => {
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  await rows(ADMIN, `create database ${name}`);
  const url = new URL(ADMIN);
  url.pathname = `/${name}`;
  return url.toString();
};

// The program as its wrapper runs it, with only the variables given and from an empty directory,
// so no .env of the machine's is read.
const migrate = (env: Readonly<Record<string, string>>) => {
  const ran = spawnSync(process.execPath, ["--no-env-file", MAIN], {
    cwd: mkdtempSync(join(tmpdir(), "migrate-")),
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
};

describe("migrate", () => {
  it("applies the migrations, says so, and exits 0 (happy)", async () => {
    const url = await freshDatabase();
    expect(migrate({ DATABASE_MIGRATION_URL: url })).toEqual({
      code: 0,
      stdout: "database migrations applied\n",
      stderr: "",
    });
    expect(await rows(url, "select to_regclass('public.sessions') is not null as made")).toEqual([
      { made: true },
    ]);
  });

  it("refuses without DATABASE_MIGRATION_URL, even with DATABASE_URL set (unhappy)", async () => {
    const url = await freshDatabase();
    expect(migrate({ DATABASE_URL: url })).toEqual({
      code: 1,
      stdout: "",
      stderr: "DATABASE_MIGRATION_URL is not set\n",
    });
    expect(await rows(url, "select to_regclass('public.sessions') is not null as made")).toEqual([
      { made: false },
    ]);
  });

  it("exits 1 on an unreachable database, naming the failure and never the password (unhappy)", () => {
    const ran = migrate({
      DATABASE_MIGRATION_URL: `postgres://oligarchy:${PASSWORD}@127.0.0.1:1/oligarchy`,
    });
    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toMatch(/^migrate: /);
    expect(ran.stderr).toContain("ECONNREFUSED 127.0.0.1:1");
    expect(ran.stderr).not.toContain(PASSWORD);
  });
});
