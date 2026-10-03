import * as Async from "@oligarchy/async";
import * as DecisionApi from "@oligarchy/decision-api";
import * as ScreenGrid from "@oligarchy/screen-grid";
import * as jarl from "jarl";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Geometry from "../src/geometry.ts";
import * as Locator from "../src/main.ts";
import {
  answering,
  CALL_TIMEOUT_MS,
  decisions,
  RETRIES,
  scoring,
  settle,
  screen,
  QUESTION,
  TASK,
} from "./support.ts";

const SCREEN = { left: 0, top: 0, right: 1280, bottom: 800 };
const cells = (box: ScreenGrid.Box, grid: number) => {
  const w = (box.right - box.left) / grid;
  const h = (box.bottom - box.top) / grid;
  return Array.from({ length: grid * grid }, (_, i) => ({
    left: box.left + (i % grid) * w,
    top: box.top + Math.floor(i / grid) * h,
    right: box.left + ((i % grid) + 1) * w,
    bottom: box.top + (Math.floor(i / grid) + 1) * h,
  }));
};

describe("weightedCentre", () => {
  it("weights each cell centre by p to the power, over the sum of every cell's (happy)", () => {
    const boxes = cells(SCREEN, 4);
    // A1 at p 0.5 and B1 at p 1; A1's centre x is 160, B1's 480, both y 100.
    const ps = [0.5, 1, ...Array(14).fill(0)];
    const fourth = Geometry.weightedCentre(boxes, ps, 4);
    expect(fourth.x).toBeCloseTo((0.0625 * 160 + 1 * 480) / 1.0625, 9);
    expect(fourth.y).toBeCloseTo(100, 9);
    const first = Geometry.weightedCentre(boxes, ps, 1);
    expect(first.x).toBeCloseTo((0.5 * 160 + 1 * 480) / 1.5, 9);
  });

  it("keeps the centre of the box when every cell answers no (edge)", () => {
    const box = { left: 240, top: 150, right: 720, bottom: 450 };
    expect(Geometry.weightedCentre(cells(box, 4), Array(16).fill(0), 4)).toEqual({
      x: 480,
      y: 300,
    });
  });
});

describe("bestCentre", () => {
  it("is the centre of the highest cell, however strong the others are (happy)", () => {
    // B2 at p 0.8 beats D4 at 0.79; B2's centre is (480, 300).
    const ps = Array(16).fill(0.3);
    ps[5] = 0.8;
    ps[15] = 0.79;
    expect(Geometry.bestCentre(cells(SCREEN, 4), ps)).toEqual({ x: 480, y: 300 });
  });

  it("takes the first in reading order when two cells tie (edge)", () => {
    // C1 and A3 both at p 0.9; C1's centre is (800, 100).
    const ps = Array(16).fill(0);
    ps[2] = 0.9;
    ps[8] = 0.9;
    expect(Geometry.bestCentre(cells(SCREEN, 4), ps)).toEqual({ x: 800, y: 100 });
  });

  it("keeps the centre of the box when every cell answers no (edge)", () => {
    const box = { left: 240, top: 150, right: 720, bottom: 450 };
    expect(Geometry.bestCentre(cells(box, 4), Array(16).fill(0))).toEqual({ x: 480, y: 300 });
  });
});

describe("nextBox", () => {
  it("is boxScale x a cell, centred on the point, in whole pixels (happy)", () => {
    expect(
      Geometry.nextBox({ x: 480, y: 300 }, SCREEN, 4, 1.5, { width: 1280, height: 800 }),
    ).toEqual({
      left: 240,
      top: 150,
      right: 720,
      bottom: 450,
    });
  });

  it.each([
    {
      name: "top-right corner",
      point: { x: 1279, y: 1 },
      box: { left: 800, top: 0, right: 1280, bottom: 300 },
    },
    {
      name: "bottom-left corner",
      point: { x: 2, y: 799 },
      box: { left: 0, top: 500, right: 480, bottom: 800 },
    },
  ])("moves inside the screen at the $name and keeps its size (edge)", ({ point, box }) => {
    expect(Geometry.nextBox(point, SCREEN, 4, 1.5, { width: 1280, height: 800 })).toEqual(box);
  });
});

describe("locate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("looks around round one's best cell, then clicks the later rounds' weighted centre (happy)", async () => {
    const { locator, asked } = decisions([
      scoring([{ B2: 1, C4: 0.9 }, { C3: 1, D3: 1 }, { A1: 1 }]),
    ]);
    const found = jarl.unwrap(
      await settle(locator.locate({ screen: await screen(), question: QUESTION, task: TASK })),
    );

    // Round one keeps B2's centre (480, 300) and C4 does not pull it. In 240-720 x 150-450, C3's
    // centre (540, 337.5) and D3's (660, 337.5) weigh the same: (600, 337.5). A1's in 510-690 x
    // 281-394 is (532.5, 295.125).
    expect(found.rounds.map((round) => round.box)).toEqual([
      SCREEN,
      { left: 240, top: 150, right: 720, bottom: 450 },
      { left: 510, top: 281, right: 690, bottom: 394 },
    ]);
    expect(found.rounds.map((round) => round.point)).toEqual([
      { x: 480, y: 300 },
      { x: 600, y: 337.5 },
      { x: 532.5, y: 295.125 },
    ]);
    expect(found.pixel).toEqual({ x: 532.5, y: 295.125 });
    expect(found.x).toBeCloseTo(532.5 / 1280, 12);
    expect(found.y).toBeCloseTo(295.125 / 800, 12);

    expect(asked).toHaveLength(3);
    for (const request of asked) {
      expect(Object.keys(request.questions)).toEqual(
        ["A", "B", "C", "D"].flatMap((_, r) => ["A", "B", "C", "D"].map((c) => `${c}${r + 1}`)),
      );
      expect(request.questions["C3"]).toEqual({
        type: "noul",
        instructions:
          "In image 2, is the word 'Lock' in grid cell C3 (column C, row 3)? 'Lock' is the label of the second entry of the System menu, written just right of a padlock icon.",
      });
      expect(
        request.images?.map((image) => ("contentType" in image ? image.contentType : "data url")),
      ).toEqual(["image/webp", "image/webp"]);
      expect(request.timeoutMs).toBe(CALL_TIMEOUT_MS);
      // overviewScale 0.25 and gridImageScale 0.5 of the 1280-pixel screen.
      const [overview, gridImage] = (request.images ?? []).map((image) =>
        "bytes" in image ? image.bytes : new Uint8Array(),
      );
      expect((await sharp(overview).metadata()).width).toBe(320);
      expect((await sharp(gridImage).metadata()).width).toBe(640 + 20);
      expect(request.state).toMatchObject({
        task: TASK,
        screen: "1280x800 pixels, origin top-left",
      });
    }
    expect(asked[1]?.state).toMatchObject({
      view: expect.stringContaining("x 240-720, y 150-450"),
    });

    // Each round hands back the pictures exactly as Clef was sent them.
    const sent = asked.map((request) =>
      (request.images ?? []).map((image) => ("bytes" in image ? image.bytes : new Uint8Array())),
    );
    expect(found.overview.bytes).toEqual(sent[0]?.[0]);
    expect(found.rounds.map((round) => round.image.bytes)).toEqual(sent.map((images) => images[1]));
    expect(found.rounds.map((round) => round.image.box)).toEqual(
      found.rounds.map((round) => round.box),
    );
  });

  it("returns NotFound with round one when its best cell is below the threshold, and asks no more (unhappy)", async () => {
    const { locator, asked } = decisions([answering(["B2"], 0.3, 0.1)]);
    const result = await settle(
      locator.locate({ screen: await screen(), question: QUESTION, task: TASK }),
    );
    expect(jarl.error.is(result, Locator.NotFound)).toBe(true);
    if (!jarl.is_err(result)) {
      throw new Error("expected NotFound");
    }
    const [overview, gridImage] = (asked[0]?.images ?? []).map((image) =>
      "bytes" in image ? image.bytes : new Uint8Array(),
    );
    expect(result.error).toMatchObject({
      best: expect.closeTo(0.3, 9),
      threshold: 0.45,
      overview: { bytes: overview },
      round: {
        box: SCREEN,
        image: { bytes: gridImage },
        best: expect.closeTo(0.3, 9),
        cells: expect.arrayContaining([
          expect.objectContaining({ label: "B2", p: expect.closeTo(0.3, 9) }),
          expect.objectContaining({ label: "A1", p: expect.closeTo(0.1, 9) }),
        ]),
      },
    });
    expect(asked).toHaveLength(1);
  });

  type Located = jarl.Result<Locator.Location, Locator.Failure>;
  const passing = [
    {
      name: "RateLimited",
      error: () => new DecisionApi.RateLimited("busy"),
      is: (r: Located) => jarl.error.is(r, DecisionApi.RateLimited),
    },
    {
      name: "Unavailable",
      error: () => new DecisionApi.Unavailable("down"),
      is: (r: Located) => jarl.error.is(r, DecisionApi.Unavailable),
    },
    {
      name: "TimedOut",
      error: () => new DecisionApi.TimedOut("slow"),
      is: (r: Located) => jarl.error.is(r, DecisionApi.TimedOut),
    },
  ];

  it.each(passing)("asks again when Clef is $name, and goes on (unhappy)", async ({ error }) => {
    const { locator, asked } = decisions([jarl.err(error()), answering(["B2", "C3", "A1"])]);
    const result = await settle(
      locator.locate({ screen: await screen(), question: QUESTION, task: TASK }),
    );
    expect(jarl.is_ok(result)).toBe(true);
    expect(asked).toHaveLength(4);
  });

  it.each(passing)(
    "returns $name when it happens on the first ask and every retry (unhappy)",
    async ({ error, is }) => {
      const { locator, asked } = decisions([jarl.err(error())]);
      const result = await settle(
        locator.locate({ screen: await screen(), question: QUESTION, task: TASK }),
      );
      expect(is(result)).toBe(true);
      expect(asked).toHaveLength(1 + RETRIES);
    },
  );

  it.each([
    {
      name: "InvalidRequest",
      error: () => new DecisionApi.InvalidRequest("bad"),
      is: (r: Located) => jarl.error.is(r, DecisionApi.InvalidRequest),
    },
    {
      name: "Refused",
      error: () => new DecisionApi.Refused("no"),
      is: (r: Located) => jarl.error.is(r, DecisionApi.Refused),
    },
    {
      name: "InvalidResponse",
      error: () => new DecisionApi.InvalidResponse("garbled"),
      is: (r: Located) => jarl.error.is(r, DecisionApi.InvalidResponse),
    },
  ])("returns $name at once, without asking again (unhappy)", async ({ error, is }) => {
    const { locator, asked } = decisions([jarl.err(error())]);
    const result = await settle(
      locator.locate({ screen: await screen(), question: QUESTION, task: TASK }),
    );
    expect(is(result)).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("returns Aborted without asking when the signal has already aborted (unhappy)", async () => {
    const { locator, asked } = decisions([answering(["B2", "C3", "A1"])]);
    const controller = new AbortController();
    controller.abort(new Async.Aborted("job stopped"));
    const result = await settle(
      locator.locate({
        screen: await screen(),
        question: QUESTION,
        task: TASK,
        signal: controller.signal,
      }),
    );
    expect(jarl.error.is(result, Async.Aborted)).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it("returns Aborted when the signal aborts while waiting to ask again (unhappy)", async () => {
    const { locator, asked } = decisions([
      jarl.err(new DecisionApi.Unavailable("down")),
      answering(["B2", "C3", "A1"]),
    ]);
    const controller = new AbortController();
    const located = locator.locate({
      screen: await screen(),
      question: QUESTION,
      task: TASK,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    controller.abort(new Async.Aborted("job stopped"));
    const result = await settle(located);
    expect(jarl.error.is(result, Async.Aborted)).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("returns QuestionInvalid without asking when the question does not name {cell} (unhappy)", async () => {
    const { locator, asked } = decisions([answering(["B2", "C3", "A1"])]);
    const result = await settle(
      locator.locate({ screen: await screen(), question: "Is the word 'Lock' here?", task: TASK }),
    );
    expect(jarl.error.is(result, Locator.QuestionInvalid)).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it("returns ImageInvalid without asking when the screen is not an image (unhappy)", async () => {
    const { locator, asked } = decisions([answering(["B2", "C3", "A1"])]);
    const result = await settle(
      locator.locate({
        screen: new TextEncoder().encode("not a png"),
        question: QUESTION,
        task: TASK,
      }),
    );
    expect(jarl.error.is(result, ScreenGrid.ImageInvalid)).toBe(true);
    expect(asked).toHaveLength(0);
  });
});
