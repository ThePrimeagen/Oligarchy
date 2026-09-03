import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { printTestDefinitions, selectTestDefinitions, type TestDefinitionRow } from "./test-def.ts";
import type { Db } from "./db/ops.ts";
import { testDefinitions } from "./db/schema.ts";

afterEach(() => mock.restoreAll());

const lockScreen = {
  id: 6,
  name: "lock-screen",
  description: "The lock screen protects and releases a session: lock from the desktop, unlock with the account password.",
  instruction: "From a rendered desktop, lock with Super+Escape.",
  proof: "Screendumps of the engaged lock screen and the restored desktop.",
  createdAt: new Date("2026-09-01T00:00:00Z"),
} satisfies TestDefinitionRow;

const install = {
  id: 1,
  name: "create-user",
  description: "Create the first user",
  instruction: "Complete user setup",
  proof: "The desktop is visible",
  createdAt: new Date("2026-09-01T00:00:00Z"),
} satisfies TestDefinitionRow;

function testDatabase(all: TestDefinitionRow[], named: TestDefinitionRow[] = all) {
  const db = {
    select: () => ({
      from: (table: unknown) => {
        assert.equal(table, testDefinitions);
        return {
          orderBy: async () => all,
          where: async () => named,
        };
      },
    }),
  } as unknown as Db;
  return db;
}

describe("selectTestDefinitions happy path", () => {
  it("returns every definition ordered by name", async () => {
    const rows = await selectTestDefinitions(testDatabase([install, lockScreen]));
    assert.deepEqual(rows, [install, lockScreen]);
  });

  it("returns the named definition", async () => {
    const rows = await selectTestDefinitions(testDatabase([install, lockScreen], [lockScreen]), "lock-screen");
    assert.deepEqual(rows, [lockScreen]);
  });
});

describe("selectTestDefinitions unhappy path", () => {
  it("rejects a name that matches no definition", async () => {
    await assert.rejects(
      () => selectTestDefinitions(testDatabase([lockScreen], []), "missing"),
      { message: "test: no test definition named missing" },
    );
  });
});

describe("printTestDefinitions happy path", () => {
  it("prints one name per line", () => {
    const log = mock.method(console, "log", () => undefined);
    printTestDefinitions([install, lockScreen], false);
    assert.deepEqual(
      log.mock.calls.map((call) => call.arguments),
      [["create-user"], ["lock-screen"]],
    );
  });

  it("prints every field of every definition as JSON", () => {
    const log = mock.method(console, "log", () => undefined);
    printTestDefinitions([install, lockScreen], true);
    assert.equal(log.mock.calls.length, 1);
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[0] as string), [
      { ...install, createdAt: install.createdAt.toISOString() },
      { ...lockScreen, createdAt: lockScreen.createdAt.toISOString() },
    ]);
  });

  it("prints every field of one named definition as JSON", () => {
    const log = mock.method(console, "log", () => undefined);
    printTestDefinitions([lockScreen], true);
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[0] as string), [
      { ...lockScreen, createdAt: lockScreen.createdAt.toISOString() },
    ]);
  });
});
