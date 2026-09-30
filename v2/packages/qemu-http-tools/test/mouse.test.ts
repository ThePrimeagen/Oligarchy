import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as QemuHttpTools from "../src/main.ts";
import { OK, posted, tools } from "./support.ts";

type MouseCall = (mouse: QemuHttpTools.Mouse) => Promise<jarl.Result<unknown, unknown>>;

const P1 = { x: 0.1, y: 0.2 };
const P2 = { x: 0.3, y: 0.4 };
const P3 = { x: 0.5, y: 0.6 };
const P4 = { x: 0.7, y: 0.8 };
const P5 = { x: 0.9, y: 0.95 };

describe("mouse", () => {
  it.each<{ readonly name: string; readonly call: MouseCall }>([
    { name: "click", call: (mouse) => mouse.click("left") },
    { name: "doubleClick", call: (mouse) => mouse.doubleClick("left") },
    { name: "drag", call: (mouse) => mouse.drag(P2, "left") },
    { name: "nudge", call: (mouse) => mouse.nudge("up") },
  ])(
    "a $name before any mouse call placed the pointer is NoPointer, and sends nothing (unhappy)",
    async ({ call }) => {
      const { qemu, asked } = await tools(OK);

      const answer = await call(qemu.mouse);

      Fake.failure(answer, QemuHttpTools.NoPointer);
      expect(qemu.mouse.at()).toBeUndefined();
      expect(asked).toEqual([]);
    },
  );

  it("a press acts where the last mouse call left the pointer, and a drag starts there and ends it at its point (happy)", async () => {
    const { qemu, asked } = await tools(OK);
    const { mouse } = qemu;

    expect(await mouse.move(P1)).toEqual(jarl.ok(P1));
    await mouse.click("left", ["ctrl"]);
    await mouse.doubleClick("right");
    expect(await mouse.drag(P2, "left", ["shift"])).toEqual(jarl.ok(P2));
    await mouse.click("left");
    await mouse.scroll(P3, "down", 2);
    await mouse.click("middle");
    await mouse.hold(P4, "left");
    await mouse.release(P5, "left");
    await mouse.click("left");

    expect(mouse.at()).toEqual(P5);
    expect(asked).toEqual([
      posted("mouse/move", P1),
      posted("mouse/click", { ...P1, button: "left", modifiers: ["ctrl"] }),
      posted("mouse/double-click", { ...P1, button: "right" }),
      posted("mouse/drag", { from: P1, to: P2, button: "left", modifiers: ["shift"] }),
      posted("mouse/click", { ...P2, button: "left" }),
      posted("mouse/scroll", { ...P3, direction: "down", ticks: 2 }),
      posted("mouse/click", { ...P3, button: "middle" }),
      posted("mouse/hold", { ...P4, button: "left" }),
      posted("mouse/release", { ...P5, button: "left" }),
      posted("mouse/click", { ...P5, button: "left" }),
    ]);
  });

  it.each<{ readonly name: string; readonly call: MouseCall }>([
    { name: "move", call: (mouse) => mouse.move(P2) },
    { name: "nudge", call: (mouse) => mouse.nudge("down") },
    { name: "drag", call: (mouse) => mouse.drag(P2, "left") },
    { name: "scroll", call: (mouse) => mouse.scroll(P2, "down", 1) },
    { name: "hold", call: (mouse) => mouse.hold(P2, "left") },
    { name: "release", call: (mouse) => mouse.release(P2, "left") },
  ])("a $name that failed leaves the pointer where it was (unhappy)", async ({ call }) => {
    const { qemu, asked } = await tools([OK, Fake.status(502, "qemu: exchange failed"), OK]);
    await qemu.mouse.move(P1);

    const answer = await call(qemu.mouse);
    await qemu.mouse.click("left");

    expect(jarl.is_err(answer)).toBe(true);
    expect(qemu.mouse.at()).toEqual(P1);
    expect(asked.at(-1)).toEqual(posted("mouse/click", { ...P1, button: "left" }));
  });

  it.each<{
    readonly direction: QemuHttpTools.Direction;
    readonly from: QemuHttpTools.Point;
    readonly to: QemuHttpTools.Point;
  }>([
    { direction: "up", from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.48 } },
    { direction: "down", from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.52 } },
    { direction: "left", from: { x: 0.5, y: 0.5 }, to: { x: 0.48, y: 0.5 } },
    { direction: "right", from: { x: 0.56, y: 0.5 }, to: { x: 0.58, y: 0.5 } },
    { direction: "left", from: { x: 0.01, y: 0.5 }, to: { x: 0, y: 0.5 } },
    { direction: "down", from: { x: 0.5, y: 0.99 }, to: { x: 0.5, y: 1 } },
  ])(
    "a nudge $direction from ($from.x, $from.y) moves the pointer to ($to.x, $to.y)",
    async ({ direction, from, to }) => {
      const { qemu, asked } = await tools(OK);
      await qemu.mouse.move(from);

      const answer = await qemu.mouse.nudge(direction);

      expect(answer).toEqual(jarl.ok(to));
      expect(qemu.mouse.at()).toEqual(to);
      expect(asked.at(-1)).toEqual(posted("mouse/move", to));
    },
  );
});
