import type * as ScreenGrid from "@oligarchy/screen-grid";
import * as jarl from "jarl";
import type { Round } from "./types.ts";

// Round one's best cell scored below the threshold: the target is not on the screen. The round and
// the overview are what Clef was sent and answered.
export const NotFound = jarl.error.define("LocatorNotFound");
export type NotFound = InstanceType<typeof NotFound> & {
  readonly best: number;
  readonly threshold: number;
  readonly overview: ScreenGrid.Image;
  readonly round: Round;
};

// The question never names {cell}: every cell would be asked the same thing.
export const QuestionInvalid = jarl.error.define("LocatorQuestionInvalid");
export type QuestionInvalid = InstanceType<typeof QuestionInvalid>;

export const notFound = (round: Round, overview: ScreenGrid.Image, threshold: number): NotFound =>
  Object.assign(
    new NotFound(`best cell scored ${round.best.toFixed(3)}, below the threshold ${threshold}`),
    { best: round.best, threshold, overview, round },
  );
