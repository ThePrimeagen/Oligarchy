import * as jarl from "jarl";

// Round one's best cell scored below the threshold: the target is not on the screen.
export const NotFound = jarl.error.define("LocatorNotFound");
export type NotFound = InstanceType<typeof NotFound> & {
  readonly best: number;
  readonly threshold: number;
};

export const notFound = (best: number, threshold: number): NotFound =>
  Object.assign(
    new NotFound(`best cell scored ${best.toFixed(3)}, below the threshold ${threshold}`),
    { best, threshold },
  );
