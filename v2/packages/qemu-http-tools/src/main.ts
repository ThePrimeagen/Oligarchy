import type * as App from "@oligarchy/app";
import type * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import type * as Http from "@oligarchy/http";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";

export { GuestOff, IntentOpen, NoPointer, NotPoweredOff, ToolInvalid } from "./errors.ts";

// A fraction of the screenshot: x from the left, y from the top, each 0..1.
export type Point = { readonly x: number; readonly y: number };
export type Button = "left" | "middle" | "right";
export type Modifier = "shift" | "ctrl" | "alt" | "super";
export type Direction = "up" | "down" | "left" | "right";
export type StopStatus = "succeeded" | "failed" | "aborted" | "completed";

type Answer<T, E> = Promise<jarl.Result<T, E>>;

type Guest = Http.HttpFailure | Errors.GuestOff;

// The job's mouse. The pointer is where the last mouse call that succeeded left it; a click, a
// double-click and a nudge act there, and a drag starts there.
export type Mouse = {
  readonly at: () => Point | undefined;
  readonly move: (to: Point) => Answer<Point, Guest>;
  readonly nudge: (direction: Direction) => Answer<Point, Guest | Errors.NoPointer>;
  readonly click: (
    button: Button,
    modifiers?: ReadonlyArray<Modifier>,
  ) => Answer<void, Guest | Errors.NoPointer>;
  readonly doubleClick: (
    button: Button,
    modifiers?: ReadonlyArray<Modifier>,
  ) => Answer<void, Guest | Errors.NoPointer>;
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

// One job's guest, over the qemu reverse proxy. The harness's calls, the guest's screen, keys and
// mouse, and the model's tools over them.
export type QemuHttpTools = {
  readonly service: "qemuHttpTools";
  readonly start: (boot: {
    readonly iso: string;
    readonly resume: boolean;
  }) => Answer<void, Http.HttpFailure>;
  readonly image: () => Answer<Uint8Array, Guest>;
  readonly serial: () => Answer<string, Http.HttpFailure>;
  readonly sendKeys: (keys: string) => Answer<void, Guest>;
  readonly mouse: Mouse;
  readonly intentStart: (message: string) => Answer<void, Http.HttpFailure | Errors.IntentOpen>;
  readonly intentEnd: () => Answer<void, Http.HttpFailure>;
  // Not the run's signal: an aborted run still ends its guest.
  readonly stop: (end: {
    readonly status: StopStatus;
    readonly reason?: string;
  }) => Answer<void, Exclude<Http.HttpFailure, Async.Aborted>>;
  readonly save: () => Answer<void, Http.HttpFailure | Errors.NotPoweredOff>;
  readonly tools: ReadonlyArray<OpenRouter.Tool>;
  // A tool call's own arguments, parsed; the caller's fields beside them are the caller's to take
  // out first.
  readonly run: (name: string, args: unknown) => Answer<Ran, RunFailure>;
};

declare module "@oligarchy/app" {
  interface Services {
    qemuHttpTools: App.Register<"qemuHttpTools", QemuHttpTools>;
  }
}

// A first start downloads its ISO before it answers.
export const START_TIMEOUT_MS = 45 * 60_000;
// A save gives the guest two minutes to power off before it keeps the disk.
export const SAVE_TIMEOUT_MS = 5 * 60_000;

// Every call names job and carries token as the bearer. signal aborts every call but stop.
export const create = (options: {
  readonly job: string;
  readonly baseUrl: string;
  readonly token: Env.Secret;
  readonly http: Http.Http;
  readonly signal?: AbortSignal;
}): QemuHttpTools => {
  void options;
  throw new Error("not implemented");
};
