import type * as OpenRouter from "@oligarchy/openrouter";
import * as jarl from "jarl";
import * as z from "zod";
import * as Errors from "./errors.ts";
import type * as Types from "./types.ts";

type Tool = {
  readonly definition: OpenRouter.Tool;
  readonly run: (calls: Types.Calls, args: unknown) => Types.Answer<Types.Ran, Types.RunFailure>;
};

const x = z.number().min(0).max(1).describe("From the left edge of the screenshot, 0 to 1");
const y = z.number().min(0).max(1).describe("From the top edge of the screenshot, 0 to 1");
const button = z.enum(["left", "middle", "right"]) satisfies z.ZodType<Types.Button>;
const modifiers = z
  .array(z.enum(["shift", "ctrl", "alt", "super"]) satisfies z.ZodType<Types.Modifier>)
  .optional()
  .describe("Keys held down while the button is pressed");
const direction = z.enum(["up", "down", "left", "right"]) satisfies z.ZodType<Types.Direction>;

const pointerAt = (at: Types.Point): Types.Ran => ({
  text: `the pointer is at ${String(at.x)}, ${String(at.y)}`,
});

// The schema is both what the model is shown and what its arguments must pass before anything is
// sent.
const tool = <S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  act: (calls: Types.Calls, args: z.output<S>) => Types.Answer<Types.Ran, Types.RunFailure>,
): Tool => {
  // Some providers refuse a $schema inside a tool's parameters.
  const parameters = Object.fromEntries(
    Object.entries(z.toJSONSchema(schema)).filter(([key]) => key !== "$schema"),
  );
  return {
    definition: { type: "function", function: { name, description, parameters } },
    run: async (calls, args) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const why = parsed.error.issues.map((issue) =>
          issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
        );
        return jarl.err(new Errors.ToolInvalid(`${name}: ${why.join("; ")}`));
      }
      return act(calls, parsed.data);
    },
  };
};

const TOOLS: ReadonlyArray<Tool> = [
  tool(
    "get_image",
    "Take a screenshot of the guest's screen. It comes back as the next image.",
    z.strictObject({}),
    async (calls) => {
      const image = await calls.image();
      if (jarl.is_err(image)) {
        return image;
      }
      return jarl.ok({ text: "took a screenshot", image: jarl.value(image) });
    },
  ),
  tool(
    "get_serial",
    "Read what the guest has written to its serial console.",
    z.strictObject({}),
    async (calls) => {
      const serial = await calls.serial();
      if (jarl.is_err(serial)) {
        return serial;
      }
      return jarl.ok({ text: jarl.value(serial) });
    },
  ),
  tool(
    "send_keys",
    "Type into the guest. Characters type as written; a key or a chord goes in angle brackets: " +
      "<ENTER>, <ESC>, <TAB>, <BACKSPACE>, <UP>, <F1>, <C-c> (ctrl), <A-F4> (alt), <S-TAB> " +
      "(shift), <M-l> (super).",
    z.strictObject({ keys: z.string().min(1) }),
    async (calls, args) => {
      const sent = await calls.sendKeys(args.keys);
      if (jarl.is_err(sent)) {
        return sent;
      }
      return jarl.ok({ text: "sent the keys" });
    },
  ),
  tool(
    "mouse_move",
    "Move the pointer to a point. Look at the next screenshot before you press.",
    z.strictObject({ x, y }),
    async (calls, args) => {
      const moved = await calls.mouse.move({ x: args.x, y: args.y });
      if (jarl.is_err(moved)) {
        return moved;
      }
      return jarl.ok(pointerAt(jarl.value(moved)));
    },
  ),
  tool(
    "mouse_nudge",
    "Move the pointer a little, 0.02 of the screen, from where it is.",
    z.strictObject({ direction }),
    async (calls, args) => {
      const moved = await calls.mouse.nudge(args.direction);
      if (jarl.is_err(moved)) {
        return moved;
      }
      return jarl.ok(pointerAt(jarl.value(moved)));
    },
  ),
  tool(
    "mouse_click",
    "Click where the pointer is.",
    z.strictObject({ button, modifiers }),
    async (calls, args) => {
      const pressed = await calls.mouse.click(args.button, args.modifiers);
      if (jarl.is_err(pressed)) {
        return pressed;
      }
      return jarl.ok(pointerAt(jarl.value(pressed)));
    },
  ),
  tool(
    "mouse_double_click",
    "Double-click where the pointer is.",
    z.strictObject({ button, modifiers }),
    async (calls, args) => {
      const pressed = await calls.mouse.doubleClick(args.button, args.modifiers);
      if (jarl.is_err(pressed)) {
        return pressed;
      }
      return jarl.ok(pointerAt(jarl.value(pressed)));
    },
  ),
  tool(
    "mouse_drag",
    "Press the button where the pointer is, move to a point, and let go there.",
    z.strictObject({ to_x: x, to_y: y, button, modifiers }),
    async (calls, args) => {
      const dragged = await calls.mouse.drag(
        { x: args.to_x, y: args.to_y },
        args.button,
        args.modifiers,
      );
      if (jarl.is_err(dragged)) {
        return dragged;
      }
      return jarl.ok(pointerAt(jarl.value(dragged)));
    },
  ),
  tool(
    "mouse_scroll",
    "Scroll at a point, a number of ticks.",
    z.strictObject({ x, y, direction, ticks: z.number().int().min(1).max(100) }),
    async (calls, args) => {
      const at = { x: args.x, y: args.y };
      const scrolled = await calls.mouse.scroll(at, args.direction, args.ticks);
      if (jarl.is_err(scrolled)) {
        return scrolled;
      }
      return jarl.ok(pointerAt(at));
    },
  ),
  tool(
    "mouse_hold",
    "Press a button at a point and keep it down.",
    z.strictObject({ x, y, button }),
    async (calls, args) => {
      const at = { x: args.x, y: args.y };
      const held = await calls.mouse.hold(at, args.button);
      if (jarl.is_err(held)) {
        return held;
      }
      return jarl.ok(pointerAt(at));
    },
  ),
  tool(
    "mouse_release",
    "Let go of a held button at a point.",
    z.strictObject({ x, y, button }),
    async (calls, args) => {
      const at = { x: args.x, y: args.y };
      const released = await calls.mouse.release(at, args.button);
      if (jarl.is_err(released)) {
        return released;
      }
      return jarl.ok(pointerAt(at));
    },
  ),
];

const BY_NAME = new Map(TOOLS.map((one) => [one.definition.function.name, one]));

export const definitions: ReadonlyArray<OpenRouter.Tool> = TOOLS.map((one) => one.definition);

export const run = (
  calls: Types.Calls,
  name: string,
  args: unknown,
): Types.Answer<Types.Ran, Types.RunFailure> => {
  const found = BY_NAME.get(name);
  if (found === undefined) {
    return Promise.resolve(jarl.err(new Errors.ToolInvalid(`no tool named "${name}"`)));
  }
  return found.run(calls, args);
};
