import * as App from "@oligarchy/app";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Tools from "./tools.ts";
import type * as Types from "./types.ts";

export { GuestOff, IntentOpen, NoPointer, NotPoweredOff, ToolInvalid } from "./errors.ts";
export { definitions } from "./tools.ts";
export type {
  Button,
  Direction,
  Modifier,
  Mouse,
  Point,
  QemuHttpTools,
  Ran,
  RunFailure,
  StopStatus,
} from "./types.ts";

declare module "@oligarchy/app" {
  interface Services {
    qemuHttpTools: App.Register<"qemuHttpTools", Types.QemuHttpTools>;
  }
}

// A first start downloads its ISO before it answers.
export const START_TIMEOUT_MS = 45 * 60_000;
// A save gives the guest two minutes to power off before it keeps the disk.
export const SAVE_TIMEOUT_MS = 5 * 60_000;

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

export type Options = {
  readonly job: string;
  readonly baseUrl: string;
  readonly token: Env.Secret;
  readonly signal?: AbortSignal;
};

// Every call names job and carries token as the bearer. signal aborts every call but stop.
export const create = App.createService<Http.Http, Options, Types.QemuHttpTools>(
  ({ http }, options) => {
    const { job, token } = options;
    const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;

    const where = (path: string): string => new URL(path, base).toString();

    const asking = (path: string): string => {
      const url = new URL(path, base);
      url.searchParams.set("job", job);
      return url.toString();
    };

    const signalled = (aborts: boolean): { readonly signal?: AbortSignal } =>
      aborts && options.signal !== undefined ? { signal: options.signal } : {};

    const getting = (): Http.Init => ({
      method: "GET",
      headers: { Authorization: `Bearer ${token.reveal()}` },
      ...signalled(true),
    });

    const posting = (
      fields: Readonly<Record<string, unknown>>,
      extra: { readonly timeoutMs?: number; readonly aborts?: false } = {},
    ): Http.Init => ({
      method: "POST",
      headers: { Authorization: `Bearer ${token.reveal()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ job, ...fields }),
      ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
      ...signalled(extra.aborts ?? true),
    });

    // A call on the guest's keys or mouse: a 409 is a guest that is off.
    const acting = (path: string, fields: Readonly<Record<string, unknown>>) =>
      http.fetch(where(path), posting(fields), {
        decode: ignored,
        status: { 409: conflict(path, Errors.GuestOff) },
      });

    let pointer: Types.Point | undefined;

    const noPointer = (what: string) =>
      jarl.err(new Errors.NoPointer(`${what}: no mouse move yet; move the pointer first`));

    // A call that names its point leaves the pointer there once it succeeds.
    const pointed = async (
      path: string,
      at: Types.Point,
      fields: Readonly<Record<string, unknown>>,
    ): Types.Answer<Types.Point, Types.Guest> => {
      const acted = await acting(path, { x: at.x, y: at.y, ...fields });
      if (jarl.is_err(acted)) {
        return acted;
      }
      pointer = { x: at.x, y: at.y };
      return jarl.ok(pointer);
    };

    const pressing =
      (path: string, what: string): Types.Mouse["click"] =>
      async (button, modifiers) => {
        const at = pointer;
        if (at === undefined) {
          return noPointer(what);
        }
        const pressed = await acting(path, { x: at.x, y: at.y, button, ...held(modifiers) });
        if (jarl.is_err(pressed)) {
          return pressed;
        }
        return jarl.ok(at);
      };

    const mouse: Types.Mouse = {
      at: () => pointer,
      move: (to) => pointed("mouse/move", to, {}),
      nudge: async (direction) => {
        if (pointer === undefined) {
          return noPointer("nudge");
        }
        const by = NUDGES[direction];
        return pointed(
          "mouse/move",
          { x: nudged(pointer.x, by.x), y: nudged(pointer.y, by.y) },
          {},
        );
      },
      click: pressing("mouse/click", "click"),
      doubleClick: pressing("mouse/double-click", "double-click"),
      drag: async (to, button, modifiers) => {
        const from = pointer;
        if (from === undefined) {
          return noPointer("drag");
        }
        const dragged = await acting("mouse/drag", {
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          button,
          ...held(modifiers),
        });
        if (jarl.is_err(dragged)) {
          return dragged;
        }
        pointer = { x: to.x, y: to.y };
        return jarl.ok(pointer);
      },
      scroll: async (at, direction, ticks) => {
        const scrolled = await pointed("mouse/scroll", at, { direction, ticks });
        return jarl.is_err(scrolled) ? scrolled : jarl.ok(undefined);
      },
      hold: async (at, button) => {
        const pressed = await pointed("mouse/hold", at, { button });
        return jarl.is_err(pressed) ? pressed : jarl.ok(undefined);
      },
      release: async (at, button) => {
        const released = await pointed("mouse/release", at, { button });
        return jarl.is_err(released) ? released : jarl.ok(undefined);
      },
    };

    const image = () =>
      http.fetch(asking("image"), getting(), {
        read: "bytes",
        decode: picture,
        status: { 409: conflict("image", Errors.GuestOff) },
      });
    const serial = () => http.fetch(asking("serial"), getting(), { read: "bytes", decode: text });
    const sendKeys = (keys: string) => acting("send-keys", { keys });

    return {
      service: "qemuHttpTools",
      start: (boot) =>
        http.fetch(
          where("start"),
          posting(
            { iso: boot.iso, mode: boot.resume ? "resume" : "fresh" },
            { timeoutMs: START_TIMEOUT_MS },
          ),
          { decode: ignored },
        ),
      image,
      serial,
      sendKeys,
      mouse,
      intentStart: (message) =>
        http.fetch(where("intent/start"), posting({ message }), {
          decode: ignored,
          status: { 409: conflict("intent/start", Errors.IntentOpen) },
        }),
      intentEnd: () => http.fetch(where("intent/end"), posting({}), { decode: ignored }),
      stop: (end) =>
        http.fetch(
          where("stop"),
          posting(
            { status: end.status, ...(end.reason === undefined ? {} : { reason: end.reason }) },
            { aborts: false },
          ),
          { decode: ignored },
        ),
      save: () =>
        http.fetch(where("save"), posting({}, { timeoutMs: SAVE_TIMEOUT_MS }), {
          decode: ignored,
          status: { 409: conflict("save", Errors.NotPoweredOff) },
        }),
      tools: Tools.definitions,
      run: (name, args) => Tools.run({ image, serial, sendKeys, mouse }, name, args),
    };
  },
);
