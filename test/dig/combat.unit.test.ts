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

  it("counts whole cubes broken and the crack on the cube being mined", () => {
    expect(Combat.cubesBroken(0)).toBe(0);
    expect(Combat.cubeCrack(0)).toBe(0);
    expect(Combat.cubesBroken(Domain.PLAYER_DAMAGE)).toBe(0);
    expect(Combat.cubeCrack(Domain.PLAYER_DAMAGE)).toBe(0.5);
    expect(Combat.cubesBroken(Domain.DIRT_HP)).toBe(1);
    expect(Combat.cubeCrack(Domain.DIRT_HP)).toBe(0);
    expect(Combat.cubesBroken(2.5)).toBe(1);
    expect(Combat.cubeCrack(2.5)).toBe(0.25);
  });
});

describe("dig damage unhappy path", () => {
  it("still digs on a miss, at 100% damage", () => {
    const afterMiss = Combat.applyDamage(0, "miss");
    expect(afterMiss).toBe(Domain.PLAYER_DAMAGE);
    expect(Combat.depth(afterMiss)).toBe(0.5);
  });

  it("does not count a cube as broken until its 2 hp are gone", () => {
    expect(Combat.cubesBroken(Domain.DIRT_HP - 0.01)).toBe(0);
    expect(Combat.cubeCrack(Domain.DIRT_HP - 0.01)).toBeGreaterThan(0.9);
    expect(Combat.cubesBroken(-1)).toBe(0);
    expect(Combat.cubeCrack(-1)).toBe(0);
  });
});
