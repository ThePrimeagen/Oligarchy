import { describe, expect, it } from "vitest";
import * as Count from "../src/count.ts";
import { within } from "./support.ts";

describe("count", () => {
  it("is open until each is settled, and idle resolves when none is (happy)", async () => {
    const count = Count.create();
    const one = count.add();
    const two = count.add();
    const idle = count.idle();

    one.settle();
    expect(count.open()).toBe(1);
    expect(await within(20, idle)).toBe(false);
    two.settle();

    expect(count.open()).toBe(0);
    expect(await within(20, Promise.all([one.settled, two.settled, idle]))).toBe(true);
    expect(await within(20, count.idle())).toBe(true);
  });

  it("a settle after the first does nothing, so the count never goes below zero (sad)", async () => {
    const count = Count.create();
    const once = count.add();
    const other = count.add();

    once.settle();
    once.settle();
    expect(count.open()).toBe(1);
    expect(await within(20, other.settled)).toBe(false);
    other.settle();
    other.settle();

    expect(count.open()).toBe(0);
    expect(await within(20, count.idle())).toBe(true);
  });
});
