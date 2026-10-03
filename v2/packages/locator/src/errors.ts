import * as jarl from "jarl";

// Round one's best cell scored below the threshold: the target is not on the screen.
export const NotFound = jarl.error.define("LocatorNotFound");
export type NotFound = InstanceType<typeof NotFound> & {
  readonly best: number;
  readonly threshold: number;
};

// The question never names {cell}: every cell would be asked the same thing.
export const QuestionInvalid = jarl.error.define("LocatorQuestionInvalid");
export type QuestionInvalid = InstanceType<typeof QuestionInvalid>;

export const notFound = (best: number, threshold: number): NotFound =>
  Object.assign(
    new NotFound(`best cell scored ${best.toFixed(3)}, below the threshold ${threshold}`),
    { best, threshold },
  );
