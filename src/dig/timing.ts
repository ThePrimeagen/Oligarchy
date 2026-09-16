import * as Domain from "./domain.ts";

export const judge = (
  deltaMs: number,
  expected: Domain.Direction,
  pressed: Domain.Direction,
): Domain.Judgment => {
  if (expected !== pressed) {
    return "miss";
  }
  const abs = deltaMs < 0 ? -deltaMs : deltaMs;
  if (abs <= Domain.PERFECT_WINDOW_MS) {
    return "perfect";
  }
  if (abs <= Domain.OKAY_WINDOW_MS) {
    return "okay";
  }
  return "miss";
};
