import * as Domain from "./domain.ts";

export const damageFor = (judgment: Domain.Judgment): number =>
  judgment === "perfect" ? Domain.PLAYER_DAMAGE * Domain.PERFECT_MULTIPLIER : Domain.PLAYER_DAMAGE;

export const applyDamage = (totalDamage: number, judgment: Domain.Judgment): number =>
  totalDamage + damageFor(judgment);

export const depth = (totalDamage: number): number => totalDamage / Domain.DIRT_HP;
