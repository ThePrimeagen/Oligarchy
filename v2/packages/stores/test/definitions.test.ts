import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database } from "./support.ts";

const LOCK = {
  name: "lock-screen",
  description: "the screen locks",
  instruction: "lock the screen",
  proof: "a screenshot of the lock screen",
};

describe("definitions", () => {
  it("keeps every wording of a name and lists the newest (happy)", async () => {
    const { db, definitions } = await database();
    jarl.unwrap(
      await db.run((d) =>
        d.insert(DbSchema.basePrompts).values({ name: "drive", prompt: "drive carefully" }),
      ),
    );

    const first = jarl.unwrap(await definitions.defineTestDefinition(LOCK));
    const second = jarl.unwrap(
      await definitions.defineTestDefinition({ ...LOCK, instruction: "press super+escape" }),
    );
    const wifi = jarl.unwrap(await definitions.defineTestDefinition({ ...LOCK, name: "wifi" }));

    expect([first.version, second.version, wifi.version]).toEqual([1, 2, 1]);
    expect(
      jarl.unwrap(await definitions.listTestDefinitions()).map((row) => [row.name, row.id]),
    ).toEqual([
      ["lock-screen", second.id],
      ["wifi", wifi.id],
    ]);
    expect(jarl.unwrap(await definitions.findTestDefinition("lock-screen"))?.instruction).toBe(
      "press super+escape",
    );
    expect(jarl.unwrap(await definitions.findTestDefinition("missing"))).toBeUndefined();
    expect(
      jarl.unwrap(await definitions.listTestDefinitionHistory("lock-screen")).map((row) => row.id),
    ).toEqual([first.id, second.id]);
    expect(jarl.unwrap(await definitions.listTestDefinitionHistory())).toHaveLength(3);
    expect(
      jarl.unwrap(await definitions.listTestBasePrompts()).map((row) => [row.name, row.prompt]),
    ).toEqual([["drive", "drive carefully"]]);
  });

  it("returns a DatabaseError from every operation while the database is down (sad)", async () => {
    const { fake, definitions } = await database();
    // A pool that has connected hands out a connection the stop has already cut.
    jarl.unwrap(await definitions.listTestDefinitions());
    await fake.stop();

    const calls = {
      listTestDefinitions: () => definitions.listTestDefinitions(),
      findTestDefinition: () => definitions.findTestDefinition("lock-screen"),
      listTestDefinitionHistory: () => definitions.listTestDefinitionHistory(),
      defineTestDefinition: () => definitions.defineTestDefinition(LOCK),
      listTestBasePrompts: () => definitions.listTestBasePrompts(),
    };

    for (const [name, call] of Object.entries(calls)) {
      const result = await call();
      expect([name, jarl.error.is(result, Db.DatabaseError)]).toEqual([name, true]);
    }
  });
});
