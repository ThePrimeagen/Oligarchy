import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as QemuHttpTools from "../src/main.ts";
import { got, OK, PNG, png, posted, SERIAL, serial, tools } from "./support.ts";

// Where a tool that acts at the pointer finds it.
const PLACED = { x: 0.1, y: 0.1 };

describe("run", () => {
  it.each<{
    readonly name: string;
    readonly args: unknown;
    readonly placed?: true;
    readonly reply: Fake.Reply;
    readonly ran: QemuHttpTools.Ran;
    readonly asked: Fake.Asked;
  }>([
    {
      name: "get_image",
      args: {},
      reply: png(),
      ran: { text: "took a screenshot", image: PNG },
      asked: got("image"),
    },
    { name: "get_serial", args: {}, reply: serial(), ran: { text: SERIAL }, asked: got("serial") },
    {
      name: "send_keys",
      args: { keys: "prime<ENTER>" },
      reply: OK,
      ran: { text: "sent the keys" },
      asked: posted("send-keys", { keys: "prime<ENTER>" }),
    },
    {
      name: "mouse_move",
      args: { x: 0.5, y: 0.25 },
      reply: OK,
      ran: { text: "the pointer is at 0.5, 0.25" },
      asked: posted("mouse/move", { x: 0.5, y: 0.25 }),
    },
    {
      name: "mouse_nudge",
      args: { direction: "right" },
      placed: true,
      reply: OK,
      ran: { text: "the pointer is at 0.12, 0.1" },
      asked: posted("mouse/move", { x: 0.12, y: 0.1 }),
    },
    {
      name: "mouse_click",
      args: { button: "left", modifiers: ["super"] },
      placed: true,
      reply: OK,
      ran: { text: "the pointer is at 0.1, 0.1" },
      asked: posted("mouse/click", { ...PLACED, button: "left", modifiers: ["super"] }),
    },
    {
      name: "mouse_double_click",
      args: { button: "left" },
      placed: true,
      reply: OK,
      ran: { text: "the pointer is at 0.1, 0.1" },
      asked: posted("mouse/double-click", { ...PLACED, button: "left" }),
    },
    {
      name: "mouse_drag",
      args: { to_x: 0.6, to_y: 0.7, button: "left" },
      placed: true,
      reply: OK,
      ran: { text: "the pointer is at 0.6, 0.7" },
      asked: posted("mouse/drag", { from: PLACED, to: { x: 0.6, y: 0.7 }, button: "left" }),
    },
    {
      name: "mouse_scroll",
      args: { x: 0.5, y: 0.5, direction: "down", ticks: 3 },
      reply: OK,
      ran: { text: "the pointer is at 0.5, 0.5" },
      asked: posted("mouse/scroll", { x: 0.5, y: 0.5, direction: "down", ticks: 3 }),
    },
    {
      name: "mouse_hold",
      args: { x: 0.3, y: 0.4, button: "left" },
      reply: OK,
      ran: { text: "the pointer is at 0.3, 0.4" },
      asked: posted("mouse/hold", { x: 0.3, y: 0.4, button: "left" }),
    },
    {
      name: "mouse_release",
      args: { x: 0.3, y: 0.4, button: "left" },
      reply: OK,
      ran: { text: "the pointer is at 0.3, 0.4" },
      asked: posted("mouse/release", { x: 0.3, y: 0.4, button: "left" }),
    },
  ])(
    "$name runs its action and says what it did (happy)",
    async ({ name, args, placed, reply, ran, asked }) => {
      const { qemu, asked: sent } = await tools(reply);
      if (placed === true) {
        await qemu.mouse.move(PLACED);
      }

      const answer = await qemu.run(name, args);

      expect(answer).toEqual(jarl.ok(ran));
      expect(sent.at(-1)).toEqual(asked);
    },
  );

  it.each<{ readonly name: string; readonly why: string; readonly args: unknown }>([
    { name: "start", why: "a harness call", args: { iso: "omarchy.iso" } },
    { name: "stop", why: "a harness call", args: { status: "failed" } },
    { name: "save", why: "a harness call", args: {} },
    { name: "intent_start", why: "a harness call", args: { message: "step 1" } },
    { name: "mouse_move", why: "a point off the screen", args: { x: 1.5, y: 0.5 } },
    { name: "mouse_move", why: "a missing y", args: { x: 0.5 } },
    {
      name: "mouse_scroll",
      why: "no ticks",
      args: { x: 0.5, y: 0.5, direction: "down", ticks: 0 },
    },
    {
      name: "mouse_scroll",
      why: "a part of a tick",
      args: { x: 0.5, y: 0.5, direction: "down", ticks: 2.5 },
    },
    {
      name: "mouse_scroll",
      why: "more than 100 ticks",
      args: { x: 0.5, y: 0.5, direction: "down", ticks: 101 },
    },
    { name: "mouse_click", why: "a button the mouse lacks", args: { button: "thumb" } },
    {
      name: "mouse_click",
      why: "a field of the caller's left in",
      args: { button: "left", step: 3 },
    },
    { name: "send_keys", why: "keys that are not text", args: { keys: 7 } },
    { name: "get_image", why: "arguments that are not an object", args: null },
  ])(
    "$name with $why is ToolInvalid naming the tool, and sends nothing (unhappy)",
    async ({ name, args }) => {
      const { qemu, asked } = await tools(OK);

      const answer = await qemu.run(name, args);

      expect(Fake.failure(answer, QemuHttpTools.ToolInvalid).message).toContain(name);
      expect(asked).toEqual([]);
    },
  );

  it.each<{
    readonly name: string;
    readonly args: unknown;
    readonly reply: Fake.Reply;
    readonly error: abstract new (...args: never[]) => Error;
    readonly said: string;
  }>([
    {
      name: "get_image",
      args: {},
      reply: Fake.status(409, "qemu: the guest is off"),
      error: QemuHttpTools.GuestOff,
      said: "qemu: the guest is off",
    },
    {
      name: "send_keys",
      args: { keys: "<SUPR>" },
      reply: Fake.status(400, 'qemu: unknown key "SUPR"'),
      error: Http.HttpBadRequest,
      said: 'qemu: unknown key "SUPR"',
    },
    {
      name: "mouse_click",
      args: { button: "left" },
      reply: OK,
      error: QemuHttpTools.NoPointer,
      said: "mouse",
    },
  ])(
    "$name comes back with the error its action met, as the action returned it (unhappy)",
    async ({ name, args, reply, error, said }) => {
      const { qemu } = await tools(reply);

      const answer = await qemu.run(name, args);

      expect(Fake.failure(answer, error).message).toContain(said);
    },
  );
});
