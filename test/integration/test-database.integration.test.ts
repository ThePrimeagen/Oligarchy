import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as Postgres from "../support/postgres.ts";

// Whatever DATABASE_URL the machine carries, a test and every process it spawns see the test
// database instead: the container, or a local port nothing listens on when Docker is absent.
const inherited = (): string =>
  execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.DATABASE_URL ?? '')"], {
    env: process.env,
    encoding: "utf8",
  });

describe("the database the tests see", () => {
  it.skipIf(Postgres.getDbUrl() === "")(
    "is the test container, in the test process and in a spawned one",
    () => {
      expect(process.env.DATABASE_URL).toBe(Postgres.getDbUrl());
      expect(inherited()).toBe(Postgres.getDbUrl());
      expect(["localhost", "127.0.0.1"]).toContain(new URL(Postgres.getDbUrl()).hostname);
    },
  );

  it.skipIf(Postgres.getDbUrl() !== "")(
    "is a local port nothing listens on when Docker is absent, never the ambient url",
    () => {
      const url = process.env.DATABASE_URL ?? "";
      expect(new URL(url).host).toBe("127.0.0.1:1");
      expect(inherited()).toBe(url);
    },
  );
});
