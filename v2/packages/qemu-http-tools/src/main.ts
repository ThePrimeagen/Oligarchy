import type * as App from "@oligarchy/app";
import * as Http from "@oligarchy/http";
import type * as OpenRouter from "@oligarchy/openrouter";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Tools from "./tools.ts";
import type * as Types from "./types.ts";

export { GuestOff, IntentOpen, NoPointer, NotPoweredOff, ToolInvalid } from "./errors.ts";
export type {
  Button,
  Direction,
  Modifier,
  Mouse,
  Point,
  Ran,
  RunFailure,
  StopStatus,
} from "./types.ts";

// A nudge's share of the screen, from where the pointer is.
const NUDGE = 0.02;
const NUDGES: Readonly<Record<Types.Direction, Types.Point>> = {
  up: { x: 0, y: -NUDGE },
  down: { x: 0, y: NUDGE },
  left: { x: -NUDGE, y: 0 },
  right: { x: NUDGE, y: 0 },
};

// Kept on the screen, and rounded to a millionth so 0.56 + 0.02 is 0.58.
const nudged = (at: number, by: number): number =>
  Math.round(Math.min(1, Math.max(0, at + by)) * 1_000_000) / 1_000_000;

const UTF8 = new TextDecoder();

const ignored = () => jarl.ok(undefined);

const picture = (body: Uint8Array) =>
  body.length === 0 ? jarl.err(new Http.HttpInvalid("no image")) : jarl.ok(body);

const text = (body: Uint8Array) => jarl.ok(UTF8.decode(body));

// A 409 names what went wrong at that one call, beside the proxy's own message.
const conflict =
  <E extends Error>(path: string, make: new (message: string) => E) =>
  (body: string): E =>
    new make(`${path}: 409${body === "" ? "" : `: ${body}`}`);

const held = (modifiers: ReadonlyArray<Types.Modifier> | undefined) =>
  modifiers === undefined || modifiers.length === 0 ? {} : { modifiers };

const noPointer = (what: string) =>
  jarl.err(new Errors.NoPointer(`${what}: no mouse move yet; move the pointer first`));

export type Options = {
  readonly job: string;
  readonly baseUrl: string;
  readonly token: { readonly reveal: () => string };
  // A first start downloads its ISO before it answers; a save gives the guest time to power off
  // before it keeps the disk.
  readonly startTimeoutMs: number;
  readonly saveTimeoutMs: number;
};

// One job's guest, over the qemu reverse proxy: the harness's calls, the guest's screen, keys and
// mouse, and the model's tools over them. Every call names the job and carries the token as the
// bearer; the signal aborts every call but stop. It keeps where the pointer is between calls.
class QemuHttpTools {
  readonly services: App.Needs<Http.Http>;
  readonly signal: AbortSignal;
  readonly options: Options;
  readonly base: string;
  readonly tools: ReadonlyArray<OpenRouter.Tool> = Tools.definitions;
  readonly mouse: Types.Mouse;
  pointer: Types.Point | undefined = undefined;

  constructor(services: App.Needs<Http.Http>, signal: AbortSignal, options: Options) {
    this.services = services;
    this.signal = signal;
    this.options = options;
    this.base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.mouse = {
      at: () => this.pointer,
      move: (to) => this.pointed("mouse/move", to, {}),
      nudge: async (direction) => {
        if (this.pointer === undefined) {
          return noPointer("nudge");
        }
        const by = NUDGES[direction];
        return this.pointed(
          "mouse/move",
          { x: nudged(this.pointer.x, by.x), y: nudged(this.pointer.y, by.y) },
          {},
        );
      },
      click: (button, modifiers) => this.press("mouse/click", "click", button, modifiers),
      doubleClick: (button, modifiers) =>
        this.press("mouse/double-click", "double-click", button, modifiers),
      drag: async (to, button, modifiers) => {
        const from = this.pointer;
        if (from === undefined) {
          return noPointer("drag");
        }
        const dragged = await this.acting("mouse/drag", {
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          button,
          ...held(modifiers),
        });
        if (jarl.is_err(dragged)) {
          return dragged;
        }
        this.pointer = { x: to.x, y: to.y };
        return jarl.ok(this.pointer);
      },
      scroll: async (at, direction, ticks) => {
        const scrolled = await this.pointed("mouse/scroll", at, { direction, ticks });
        return jarl.is_err(scrolled) ? scrolled : jarl.ok(undefined);
      },
      hold: async (at, button) => {
        const pressed = await this.pointed("mouse/hold", at, { button });
        return jarl.is_err(pressed) ? pressed : jarl.ok(undefined);
      },
      release: async (at, button) => {
        const released = await this.pointed("mouse/release", at, { button });
        return jarl.is_err(released) ? released : jarl.ok(undefined);
      },
    };
  }

  where(path: string): string {
    return new URL(path, this.base).toString();
  }

  asking(path: string): string {
    const url = new URL(path, this.base);
    url.searchParams.set("job", this.options.job);
    return url.toString();
  }

  signalled(aborts: boolean): { readonly signal?: AbortSignal } {
    return aborts ? { signal: this.signal } : {};
  }

  getting(): Http.Init {
    return {
      method: "GET",
      headers: { Authorization: `Bearer ${this.options.token.reveal()}` },
      ...this.signalled(true),
    };
  }

  posting(
    fields: Readonly<Record<string, unknown>>,
    extra: { readonly timeoutMs?: number; readonly aborts?: false } = {},
  ): Http.Init {
    return {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token.reveal()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: this.options.job, ...fields }),
      ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
      ...this.signalled(extra.aborts ?? true),
    };
  }

  // A call on the guest's keys or mouse: a 409 is a guest that is off.
  acting(path: string, fields: Readonly<Record<string, unknown>>): Types.Answer<void, Types.Guest> {
    return this.services.http.fetch(this.where(path), this.posting(fields), {
      decode: ignored,
      status: { 409: conflict(path, Errors.GuestOff) },
    });
  }

  // A call that names its point leaves the pointer there once it succeeds.
  async pointed(
    path: string,
    at: Types.Point,
    fields: Readonly<Record<string, unknown>>,
  ): Types.Answer<Types.Point, Types.Guest> {
    const acted = await this.acting(path, { x: at.x, y: at.y, ...fields });
    if (jarl.is_err(acted)) {
      return acted;
    }
    this.pointer = { x: at.x, y: at.y };
    return jarl.ok(this.pointer);
  }

  // A press acts where the pointer is, and leaves it there.
  async press(
    path: string,
    what: string,
    button: Types.Button,
    modifiers: ReadonlyArray<Types.Modifier> | undefined,
  ): Types.Answer<Types.Point, Types.Guest | Errors.NoPointer> {
    const at = this.pointer;
    if (at === undefined) {
      return noPointer(what);
    }
    const pressed = await this.acting(path, { x: at.x, y: at.y, button, ...held(modifiers) });
    if (jarl.is_err(pressed)) {
      return pressed;
    }
    return jarl.ok(at);
  }

  start(boot: {
    readonly iso: string;
    readonly resume: boolean;
  }): Types.Answer<void, Http.HttpFailure> {
    return this.services.http.fetch(
      this.where("start"),
      this.posting(
        { iso: boot.iso, mode: boot.resume ? "resume" : "fresh" },
        { timeoutMs: this.options.startTimeoutMs },
      ),
      { decode: ignored },
    );
  }

  image(): Types.Answer<Uint8Array, Types.Guest> {
    return this.services.http.fetch(this.asking("image"), this.getting(), {
      read: "bytes",
      decode: picture,
      status: { 409: conflict("image", Errors.GuestOff) },
    });
  }

  serial(): Types.Answer<string, Http.HttpFailure> {
    return this.services.http.fetch(this.asking("serial"), this.getting(), {
      read: "bytes",
      decode: text,
    });
  }

  sendKeys(keys: string): Types.Answer<void, Types.Guest> {
    return this.acting("send-keys", { keys });
  }

  intentStart(message: string): Types.Answer<void, Http.HttpFailure | Errors.IntentOpen> {
    return this.services.http.fetch(this.where("intent/start"), this.posting({ message }), {
      decode: ignored,
      status: { 409: conflict("intent/start", Errors.IntentOpen) },
    });
  }

  intentEnd(): Types.Answer<void, Http.HttpFailure> {
    return this.services.http.fetch(this.where("intent/end"), this.posting({}), {
      decode: ignored,
    });
  }

  // Not aborted by the signal: an aborted run still ends its guest.
  stop(end: {
    readonly status: Types.StopStatus;
    readonly reason?: string;
  }): Types.Answer<void, Http.HttpFailure> {
    return this.services.http.fetch(
      this.where("stop"),
      this.posting(
        { status: end.status, ...(end.reason === undefined ? {} : { reason: end.reason }) },
        { aborts: false },
      ),
      { decode: ignored },
    );
  }

  save(): Types.Answer<void, Http.HttpFailure | Errors.NotPoweredOff> {
    return this.services.http.fetch(
      this.where("save"),
      this.posting({}, { timeoutMs: this.options.saveTimeoutMs }),
      { decode: ignored, status: { 409: conflict("save", Errors.NotPoweredOff) } },
    );
  }

  // A tool call's own arguments, parsed; the caller's fields beside them are the caller's to take
  // out first.
  run(name: string, args: unknown): Types.Answer<Types.Ran, Types.RunFailure> {
    return Tools.run(this, name, args);
  }
}

export type { QemuHttpTools };

export const create = (
  services: App.Needs<Http.Http>,
  signal: AbortSignal,
  options: Options,
): QemuHttpTools => new QemuHttpTools(services, signal, options);
