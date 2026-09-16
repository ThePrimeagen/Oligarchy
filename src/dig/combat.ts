import * as Domain from "./domain.ts";

export const damageFor = (judgment: Domain.Judgment): number =>
  judgment === "perfect" ? Domain.PLAYER_DAMAGE * Domain.PERFECT_MULTIPLIER : Domain.PLAYER_DAMAGE;

export const applyDamage = (totalDamage: number, judgment: Domain.Judgment): number =>
  totalDamage + damageFor(judgment);

export const depth = (totalDamage: number): number => totalDamage / Domain.DIRT_HP;

export const cubesBroken = (totalDamage: number): number =>
  totalDamage <= 0 ? 0 : Math.floor(totalDamage / Domain.DIRT_HP);

export const cubeCrack = (totalDamage: number): number =>
  totalDamage <= 0 ? 0 : (totalDamage % Domain.DIRT_HP) / Domain.DIRT_HP;
