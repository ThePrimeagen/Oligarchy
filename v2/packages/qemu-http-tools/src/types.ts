import type * as Http from "@oligarchy/http";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";

// A fraction of the screenshot: x from the left, y from the top, each 0..1.
export type Point = { readonly x: number; readonly y: number };
export type Button = "left" | "middle" | "right";
export type Modifier = "shift" | "ctrl" | "alt" | "super";
export type Direction = "up" | "down" | "left" | "right";
export type StopStatus = "succeeded" | "failed" | "aborted" | "completed";

export type Answer<T, E> = Promise<jarl.Result<T, E>>;

export type Guest = Http.HttpFailure | Errors.GuestOff;

// The job's mouse. The pointer is where the last mouse call that succeeded left it; a click, a
// double-click and a nudge act there, and a drag starts there. A click answers where it pressed.
export type Mouse = {
  readonly at: () => Point | undefined;
  readonly move: (to: Point) => Answer<Point, Guest>;
  readonly nudge: (direction: Direction) => Answer<Point, Guest | Errors.NoPointer>;
  readonly click: (
    button: Button,
    modifiers?: ReadonlyArray<Modifier>,
  ) => Answer<Point, Guest | Errors.NoPointer>;
  readonly doubleClick: (
    button: Button,
    modifiers?: ReadonlyArray<Modifier>,
  ) => Answer<Point, Guest | Errors.NoPointer>;
  readonly drag: (
    to: Point,
    button: Button,
    modifiers?: ReadonlyArray<Modifier>,
  ) => Answer<Point, Guest | Errors.NoPointer>;
  readonly scroll: (at: Point, direction: Direction, ticks: number) => Answer<void, Guest>;
  readonly hold: (at: Point, button: Button) => Answer<void, Guest>;
  readonly release: (at: Point, button: Button) => Answer<void, Guest>;
};

// What a tool call did: what the model reads back, and the screenshot when it took one.
export type Ran = { readonly text: string; readonly image?: Uint8Array };

export type RunFailure = Guest | Errors.NoPointer | Errors.ToolInvalid;

// What a tool acts on: the guest's screen, keys and mouse. Start, intents, stop and save are the
// harness's, and no tool reaches them.
export type Calls = {
  readonly image: () => Answer<Uint8Array, Guest>;
  readonly serial: () => Answer<string, Http.HttpFailure>;
  readonly sendKeys: (keys: string) => Answer<void, Guest>;
  readonly mouse: Mouse;
};
