import { describe, expect, it } from "vitest";
import * as App from "../src/main.ts";

// Whether a promise has settled, after everything already queued has run.
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

describe("waitForAbort", () => {
  it("settles once the signal aborts, and not before (happy)", async () => {
    const aborter = new AbortController();

    const waiting = App.waitForAbort(aborter.signal);

    expect(await settled(waiting)).toBe(false);
    aborter.abort();
    expect(await settled(waiting)).toBe(true);
  });

  it("a signal that has already aborted settles at once (unhappy)", async () => {
    const aborter = new AbortController();
    aborter.abort();

    expect(await settled(App.waitForAbort(aborter.signal))).toBe(true);
  });
});
