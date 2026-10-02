import type * as App from "@oligarchy/app";
import * as Http from "@oligarchy/http";
import * as HttpClient from "@oligarchy/http/client";
import type { Routes } from "@oligarchy/qemu-server/routes";
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
  modifiers === undefined || modifiers.length === 0 ? {} : { modifiers: [...modifiers] };

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
  readonly sendKeysTimeoutMs: number;
};

// One job's guest, over the qemu reverse proxy: the harness's calls, the guest's screen, keys and
// mouse, and the model's tools over them. Every call names the job and carries the token as the
// bearer; the signal aborts every call but stop. It keeps where the pointer is between calls.
class QemuHttpTools {
  readonly services: App.Needs<Http.Http>;
  readonly signal: AbortSignal;
  readonly options: Options;
  readonly client: ReturnType<typeof HttpClient.connect<Routes>>;
  readonly tools: ReadonlyArray<OpenRouter.Tool> = Tools.definitions;
  readonly mouse: Types.Mouse;
  pointer: Types.Point | undefined = undefined;

  constructor(services: App.Needs<Http.Http>, signal: AbortSignal, options: Options) {
    this.services = services;
    this.signal = signal;
    this.options = options;
    this.client = HttpClient.connect<Routes>({
      http: services.http,
      url: options.baseUrl,
      token: options.token,
      signal,
    });
    this.mouse = {
      at: () => this.pointer,
      move: (to) =>
        this.pointed(
          to,
          this.client.prepare("$post", "/mouse/move", {
            json: { job: options.job, ...to },
          }),
        ),
      nudge: async (direction) => {
        if (this.pointer === undefined) {
          return noPointer("nudge");
        }
        const by = NUDGES[direction];
        return this.mouse.move({
          x: nudged(this.pointer.x, by.x),
          y: nudged(this.pointer.y, by.y),
        });
      },
      click: (button, modifiers) => this.press("mouse/click", "click", button, modifiers),
      doubleClick: (button, modifiers) =>
        this.press("mouse/double-click", "double-click", button, modifiers),
      drag: async (to, button, modifiers) => {
        const from = this.pointer;
        if (from === undefined) {
          return noPointer("drag");
        }
        const dragged = await this.acting(
          this.client.prepare("$post", "/mouse/drag", {
            json: {
              job: options.job,
              from: { x: from.x, y: from.y },
              to: { x: to.x, y: to.y },
              button,
              ...held(modifiers),
            },
          }),
        );
        if (jarl.is_err(dragged)) {
          return dragged;
        }
        this.pointer = { x: to.x, y: to.y };
        return jarl.ok(this.pointer);
      },
      scroll: async (at, direction, ticks) => {
        const scrolled = await this.pointed(
          at,
          this.client.prepare("$post", "/mouse/scroll", {
            json: { job: options.job, ...at, direction, ticks },
          }),
        );
        return jarl.is_err(scrolled) ? scrolled : jarl.ok(undefined);
      },
      hold: async (at, button) => {
        const pressed = await this.pointed(
          at,
          this.client.prepare("$post", "/mouse/hold", {
            json: { job: options.job, ...at, button },
          }),
        );
        return jarl.is_err(pressed) ? pressed : jarl.ok(undefined);
      },
      release: async (at, button) => {
        const released = await this.pointed(
          at,
          this.client.prepare("$post", "/mouse/release", {
            json: { job: options.job, ...at, button },
          }),
        );
        return jarl.is_err(released) ? released : jarl.ok(undefined);
      },
    };
  }

  // Request preparation checks the method, path and input against QemuServer's routes.
  acting(request: [string, Http.Init]): Types.Answer<void, Types.Guest> {
    return this.services.http.fetch(...request, {
      decode: ignored,
      status: { 409: conflict(new URL(request[0]).pathname.slice(1), Errors.GuestOff) },
    });
  }

  // A call that names its point leaves the pointer there once it succeeds.
  async pointed(
    at: Types.Point,
    request: [string, Http.Init],
  ): Types.Answer<Types.Point, Types.Guest> {
    const acted = await this.acting(request);
    if (jarl.is_err(acted)) {
      return acted;
    }
    this.pointer = { x: at.x, y: at.y };
    return jarl.ok(this.pointer);
  }

  // A press acts where the pointer is, and leaves it there.
  async press(
    path: "mouse/click" | "mouse/double-click",
    what: string,
    button: Types.Button,
    modifiers: ReadonlyArray<Types.Modifier> | undefined,
  ): Types.Answer<Types.Point, Types.Guest | Errors.NoPointer> {
    const at = this.pointer;
    if (at === undefined) {
      return noPointer(what);
    }
    const pressed = await this.acting(
      this.client.prepare("$post", `/${path}`, {
        json: { job: this.options.job, ...at, button, ...held(modifiers) },
      }),
    );
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
      ...this.client.prepare(
        "$post",
        "/start",
        {
          json: { job: this.options.job, iso: boot.iso, mode: boot.resume ? "resume" : "fresh" },
        },
        { timeoutMs: this.options.startTimeoutMs },
      ),
      { decode: ignored },
    );
  }

  image(): Types.Answer<Uint8Array, Types.Guest> {
    return this.services.http.fetch(
      ...this.client.prepare("$get", "/image", { query: { job: this.options.job } }),
      {
        read: "bytes",
        decode: picture,
        status: { 409: conflict("image", Errors.GuestOff) },
      },
    );
  }

  serial(): Types.Answer<string, Http.HttpFailure> {
    return this.services.http.fetch(
      ...this.client.prepare("$get", "/serial", { query: { job: this.options.job } }),
      {
        read: "bytes",
        decode: text,
      },
    );
  }

  sendKeys(keys: string): Types.Answer<void, Types.Guest> {
    return this.acting(
      this.client.prepare(
        "$post",
        "/send-keys",
        { json: { job: this.options.job, keys } },
        { timeoutMs: this.options.sendKeysTimeoutMs },
      ),
    );
  }

  intentStart(message: string): Types.Answer<void, Http.HttpFailure | Errors.IntentOpen> {
    return this.services.http.fetch(
      ...this.client.prepare("$post", "/intent/start", {
        json: { job: this.options.job, message },
      }),
      {
        decode: ignored,
        status: { 409: conflict("intent/start", Errors.IntentOpen) },
      },
    );
  }

  intentEnd(): Types.Answer<void, Http.HttpFailure> {
    return this.services.http.fetch(
      ...this.client.prepare("$post", "/intent/end", { json: { job: this.options.job } }),
      {
        decode: ignored,
      },
    );
  }

  // Not aborted by the signal: an aborted run still ends its guest.
  stop(end: {
    readonly status: Types.StopStatus;
    readonly reason?: string;
  }): Types.Answer<void, Http.HttpFailure> {
    return this.services.http.fetch(
      ...this.client.prepare(
        "$post",
        "/stop",
        {
          json: {
            job: this.options.job,
            status: end.status,
            ...(end.reason === undefined ? {} : { reason: end.reason }),
          },
        },
        { signal: new AbortController().signal },
      ),
      { decode: ignored },
    );
  }

  save(): Types.Answer<void, Http.HttpFailure | Errors.NotPoweredOff> {
    return this.services.http.fetch(
      ...this.client.prepare(
        "$post",
        "/save",
        { json: { job: this.options.job } },
        { timeoutMs: this.options.saveTimeoutMs },
      ),
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
