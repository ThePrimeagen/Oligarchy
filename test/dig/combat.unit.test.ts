import { describe, expect, it } from "vitest";
import * as Combat from "../../src/dig/combat.ts";
import * as Domain from "../../src/dig/domain.ts";

describe("dig damage happy path", () => {
  it("deals 1 on okay and miss, 1.25 on perfect", () => {
    expect(Combat.damageFor("okay")).toBe(Domain.PLAYER_DAMAGE);
    expect(Combat.damageFor("miss")).toBe(Domain.PLAYER_DAMAGE);
    expect(Combat.damageFor("perfect")).toBe(Domain.PLAYER_DAMAGE * Domain.PERFECT_MULTIPLIER);
  });

  it("moves depth by damage over the first dirt's 2 hp", () => {
    const afterOkay = Combat.applyDamage(0, "okay");
    expect(afterOkay).toBe(Domain.PLAYER_DAMAGE);
    expect(Combat.depth(afterOkay)).toBe(Domain.PLAYER_DAMAGE / Domain.DIRT_HP);

    const afterTwoOkays = Combat.applyDamage(afterOkay, "okay");
    expect(afterTwoOkays).toBe(2);
    expect(Combat.depth(afterTwoOkays)).toBe(1);

    const afterPerfect = Combat.applyDamage(0, "perfect");
    expect(afterPerfect).toBe(1.25);
    expect(Combat.depth(afterPerfect)).toBe(1.25 / Domain.DIRT_HP);
  });
});

describe("dig damage unhappy path", () => {
  it("still digs on a miss, at 100% damage", () => {
    const afterMiss = Combat.applyDamage(0, "miss");
    expect(afterMiss).toBe(Domain.PLAYER_DAMAGE);
    expect(Combat.depth(afterMiss)).toBe(0.5);
  });
});
