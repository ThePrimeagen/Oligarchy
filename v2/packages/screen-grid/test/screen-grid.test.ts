import * as jarl from "jarl";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ScreenGrid from "../src/main.ts";

const SCREEN = { width: 1280, height: 800 };
const png = () =>
  sharp({ create: { ...SCREEN, channels: 3, background: "#204060" } })
    .png()
    .toBuffer();

describe("toScreen", () => {
  it("maps fractions of a box to screen pixels: its centre and both corners (happy)", () => {
    const box = { left: 100, top: 200, right: 420, bottom: 400 };
    expect(ScreenGrid.toScreen(box, 0.5, 0.5)).toEqual({ x: 260, y: 300 });
    expect(ScreenGrid.toScreen(box, 0, 0)).toEqual({ x: 100, y: 200 });
    expect(ScreenGrid.toScreen(box, 1, 1)).toEqual({ x: 420, y: 400 });
  });
});

describe("view", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enlarges the box to the asked width, grids it, and names cells that tile the box (happy)", async () => {
    const screen = jarl.unwrap(await ScreenGrid.open(await png()));
    const box = { left: 240, top: 150, right: 720, bottom: 450 };
    const view = jarl.unwrap(
      await ScreenGrid.view(screen, { box, columns: 4, rows: 4, width: 1280 }),
    );

    expect(view.contentType).toBe("image/webp");
    const meta = await sharp(view.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect({ width: meta.width, height: meta.height }).toEqual({
      width: 1280 + view.margin,
      height: 800 + view.margin,
    });
    expect(view.cells.map((cell) => cell.label)).toEqual([
      ..."ABCD".split("").map((c) => `${c}1`),
      ..."ABCD".split("").map((c) => `${c}2`),
      ..."ABCD".split("").map((c) => `${c}3`),
      ..."ABCD".split("").map((c) => `${c}4`),
    ]);
    expect(view.cells[0]).toEqual({
      label: "A1",
      column: 0,
      row: 0,
      box: { left: 240, top: 150, right: 360, bottom: 225 },
    });
    expect(view.cells[15]?.box).toEqual({ left: 600, top: 375, right: 720, bottom: 450 });
    const area = view.cells.reduce(
      (sum, { box: b }) => sum + (b.right - b.left) * (b.bottom - b.top),
      0,
    );
    expect(area).toBe((box.right - box.left) * (box.bottom - box.top));
  });

  it.each([
    { name: "an empty box", box: { left: 300, top: 300, right: 300, bottom: 400 } },
    {
      name: "a box past the screen's right edge",
      box: { left: 1000, top: 0, right: 1281, bottom: 100 },
    },
    { name: "a box above the screen", box: { left: 0, top: -1, right: 100, bottom: 100 } },
    { name: "a box between pixels", box: { left: 0.5, top: 0, right: 100, bottom: 100 } },
  ])("refuses $name with BoxInvalid (unhappy)", async ({ box }) => {
    const screen = jarl.unwrap(await ScreenGrid.open(await png()));
    const result = await ScreenGrid.view(screen, { box, columns: 4, rows: 4, width: 1280 });
    expect(jarl.error.is(result, ScreenGrid.BoxInvalid)).toBe(true);
  });
});

describe("open", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refuses bytes that are not an image with ImageInvalid (unhappy)", async () => {
    const result = await ScreenGrid.open(new TextEncoder().encode("not a screenshot"));
    expect(jarl.error.is(result, ScreenGrid.ImageInvalid)).toBe(true);
  });
});
