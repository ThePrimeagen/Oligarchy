import { assert, describe, expect, it } from "vitest";
import { Option, Result } from "effect";
import * as Pointer from "../../src/harness/pointer.ts";

const AT = Option.some({ x: "0.25", y: "0.75" });
const NOWHERE = Option.none<Pointer.Point>();

const placed = (args: ReadonlyArray<string>, at: Option.Option<Pointer.Point>) => {
  const result = Pointer.placed(args, at);
  return Result.isSuccess(result) ? result.success : result.failure.message;
};

describe("the harness's pointer", () => {
  it("clicks and double-clicks where the pointer is", () => {
    expect(placed(["mouse", "click", "--button", "right"], AT)).toEqual([
      "mouse",
      "click",
      "--button",
      "right",
      "--x",
      "0.25",
      "--y",
      "0.75",
    ]);
    expect(placed(["mouse", "double-click"], AT)).toEqual([
      "mouse",
      "double-click",
      "--x",
      "0.25",
      "--y",
      "0.75",
    ]);
  });

  it("refuses a click or a double-click before any move (unhappy)", () => {
    expect(placed(["mouse", "click"], NOWHERE)).toBe(
      "mouse click: no mouse move yet; mouse move to the point first",
    );
    expect(placed(["mouse", "double-click", "--button", "left"], NOWHERE)).toBe(
      "mouse double-click: no mouse move yet; mouse move to the point first",
    );
  });

  it("refuses a click or a double-click that names its own point (unhappy)", () => {
    for (const args of [
      ["mouse", "click", "--x", "0.5", "--y", "0.5"],
      ["mouse", "click", "--x=0.5"],
      ["mouse", "click", "--y", "0.5"],
    ]) {
      expect(placed(args, AT), args.join(" ")).toBe(
        "mouse click: takes no --x or --y; it clicks where the pointer is",
      );
    }
    expect(placed(["mouse", "double-click", "--x", "0.5"], NOWHERE)).toBe(
      "mouse double-click: takes no --x or --y; it clicks where the pointer is",
    );
  });

  it("drags from where the pointer is to the point it names", () => {
    expect(
      placed(["mouse", "drag", "--to-x", "0.9", "--to-y", "0.1", "--modifier", "super"], AT),
    ).toEqual([
      "mouse",
      "drag",
      "--to-x",
      "0.9",
      "--to-y",
      "0.1",
      "--modifier",
      "super",
      "--from-x",
      "0.25",
      "--from-y",
      "0.75",
    ]);
  });

  it("refuses a drag before any move, or one that names where it starts (unhappy)", () => {
    expect(placed(["mouse", "drag", "--to-x", "0.9", "--to-y", "0.1"], NOWHERE)).toBe(
      "mouse drag: no mouse move yet; mouse move to where the drag starts first",
    );
    for (const args of [
      ["mouse", "drag", "--from-x", "0.1", "--from-y", "0.1", "--to-x", "0.9", "--to-y", "0.1"],
      ["mouse", "drag", "--from-y=0.1", "--to-x", "0.9", "--to-y", "0.1"],
    ]) {
      expect(placed(args, AT), args.join(" ")).toBe(
        "mouse drag: takes no --from-x or --from-y; it starts where the pointer is",
      );
    }
  });

  it("nudges the pointer a hundredth from where it is, up lowering y", () => {
    const held = ["--agent-id", "OLI-1", "--session-id", "s"];
    expect(placed(["mouse", "move-up", ...held], AT)).toEqual([
      "mouse",
      "move",
      ...held,
      "--x",
      "0.25",
      "--y",
      "0.74",
    ]);
    expect(placed(["mouse", "move-down"], AT)).toEqual([
      "mouse",
      "move",
      "--x",
      "0.25",
      "--y",
      "0.76",
    ]);
    expect(placed(["mouse", "move-left"], AT)).toEqual([
      "mouse",
      "move",
      "--x",
      "0.24",
      "--y",
      "0.75",
    ]);
    expect(placed(["mouse", "move-right"], AT)).toEqual([
      "mouse",
      "move",
      "--x",
      "0.26",
      "--y",
      "0.75",
    ]);
    expect(placed(["mouse", "move-down"], Option.some({ x: "0.56", y: "0.56" }))).toEqual([
      "mouse",
      "move",
      "--x",
      "0.56",
      "--y",
      "0.57",
    ]);
  });

  it("keeps a nudge on the screen at its edges (unhappy)", () => {
    expect(placed(["mouse", "move-up"], Option.some({ x: "0.5", y: "0" }))).toEqual([
      "mouse",
      "move",
      "--x",
      "0.5",
      "--y",
      "0",
    ]);
    expect(placed(["mouse", "move-down"], Option.some({ x: "0.5", y: "0.995" }))).toEqual([
      "mouse",
      "move",
      "--x",
      "0.5",
      "--y",
      "1",
    ]);
    expect(placed(["mouse", "move-left"], Option.some({ x: "0.004", y: "0.5" }))).toEqual([
      "mouse",
      "move",
      "--x",
      "0",
      "--y",
      "0.5",
    ]);
    expect(placed(["mouse", "move-right"], Option.some({ x: "1", y: "0.5" }))).toEqual([
      "mouse",
      "move",
      "--x",
      "1",
      "--y",
      "0.5",
    ]);
  });

  it("refuses a nudge before any move, or one that names a point (unhappy)", () => {
    expect(placed(["mouse", "move-up"], NOWHERE)).toBe(
      "mouse move-up: no mouse move yet; mouse move to the point first",
    );
    expect(placed(["mouse", "move-right", "--x", "0.5"], AT)).toBe(
      "mouse move-right: takes no --x or --y; it moves from where the pointer is",
    );
    expect(placed(["mouse", "move-left", "--y=0.5"], AT)).toBe(
      "mouse move-left: takes no --x or --y; it moves from where the pointer is",
    );
  });

  it("is where the nudge left it, so nudges add up", () => {
    const once = Pointer.placed(["mouse", "move-up"], AT);
    assert(Result.isSuccess(once));
    const moved = Pointer.after(once.success, AT);
    const twice = Pointer.placed(["mouse", "move-up"], moved);
    assert(Result.isSuccess(twice));
    expect(Pointer.after(twice.success, moved)).toEqual(Option.some({ x: "0.25", y: "0.73" }));
  });

  it("leaves every other action as the model wrote it, with or without a pointer", () => {
    for (const args of [
      ["mouse", "move", "--x", "0.5", "--y", "0.5"],
      ["mouse", "scroll", "--x", "0.5", "--y", "0.5", "--direction", "down"],
      ["mouse", "hold", "--x", "0.5", "--y", "0.5"],
      ["send-keys", "--keys", "--x"],
      ["get-image"],
    ]) {
      expect(placed(args, NOWHERE), args.join(" ")).toEqual(args);
      expect(placed(args, AT), args.join(" ")).toEqual(args);
    }
  });

  it("is where the last action that placed it left it", () => {
    const moved = { x: "0.5", y: "0.6" };
    expect(Pointer.after(["mouse", "move", "--x", "0.5", "--y", "0.6"], NOWHERE)).toEqual(
      Option.some(moved),
    );
    expect(Pointer.after(["mouse", "move", "--x=0.5", "--y=0.6"], AT)).toEqual(Option.some(moved));
    for (const verb of ["scroll", "hold", "release"]) {
      expect(Pointer.after(["mouse", verb, "--x", "0.5", "--y", "0.6"], AT), verb).toEqual(
        Option.some(moved),
      );
    }
    expect(
      Pointer.after(
        ["mouse", "drag", "--to-x", "0.5", "--to-y", "0.6", "--from-x", "0.25", "--from-y", "0.75"],
        AT,
      ),
    ).toEqual(Option.some(moved));
    expect(Pointer.after(["mouse", "click", "--x", "0.25", "--y", "0.75"], AT)).toEqual(AT);
    expect(Pointer.after(["send-keys", "--keys", "a"], AT)).toEqual(AT);
    expect(Pointer.after(["get-image"], NOWHERE)).toEqual(NOWHERE);
  });
});
