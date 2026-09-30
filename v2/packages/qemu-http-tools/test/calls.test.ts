import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as QemuHttpTools from "../src/main.ts";
import { DEFAULT_TIMEOUT_MS, got, OK, PNG, png, posted, SERIAL, serial, tools } from "./support.ts";

type Call = (qemu: QemuHttpTools.QemuHttpTools) => Promise<jarl.Result<unknown, unknown>>;

const ISO = "https://iso.omarchy.org/omarchy-3.1.iso";
const STEP = "Press Super+Escape. The System menu opens.";
const AT = { x: 0.5, y: 0.25 };

// A mouse call that acts at the pointer, after a move has placed it.
const placed =
  (call: (mouse: QemuHttpTools.Mouse) => Promise<jarl.Result<unknown, unknown>>): Call =>
  async (qemu) => {
    await qemu.mouse.move(AT);
    return call(qemu.mouse);
  };

// Every call, and how many requests come before its own.
const EVERY_CALL: ReadonlyArray<{
  readonly name: string;
  readonly call: Call;
  readonly before: number;
}> = [
  { name: "start", call: (qemu) => qemu.start({ iso: ISO, resume: false }), before: 0 },
  { name: "image", call: (qemu) => qemu.image(), before: 0 },
  { name: "serial", call: (qemu) => qemu.serial(), before: 0 },
  { name: "sendKeys", call: (qemu) => qemu.sendKeys("prime<ENTER>"), before: 0 },
  { name: "mouse.move", call: (qemu) => qemu.mouse.move(AT), before: 0 },
  { name: "mouse.nudge", call: placed((mouse) => mouse.nudge("up")), before: 1 },
  { name: "mouse.click", call: placed((mouse) => mouse.click("left")), before: 1 },
  { name: "mouse.doubleClick", call: placed((mouse) => mouse.doubleClick("left")), before: 1 },
  {
    name: "mouse.drag",
    call: placed((mouse) => mouse.drag({ x: 0.9, y: 0.9 }, "left")),
    before: 1,
  },
  { name: "mouse.scroll", call: (qemu) => qemu.mouse.scroll(AT, "down", 3), before: 0 },
  { name: "mouse.hold", call: (qemu) => qemu.mouse.hold(AT, "left"), before: 0 },
  { name: "mouse.release", call: (qemu) => qemu.mouse.release(AT, "left"), before: 0 },
  { name: "intentStart", call: (qemu) => qemu.intentStart(STEP), before: 0 },
  { name: "intentEnd", call: (qemu) => qemu.intentEnd(), before: 0 },
  { name: "stop", call: (qemu) => qemu.stop({ status: "failed" }), before: 0 },
  { name: "save", call: (qemu) => qemu.save(), before: 0 },
];

const byName = (name: string) => {
  const found = EVERY_CALL.find((one) => one.name === name);
  if (found === undefined) {
    throw new Error(`no call named ${name}`);
  }
  return found;
};

describe("calls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<{
    readonly name: string;
    readonly call: Call;
    readonly reply: Fake.Reply;
    readonly asked: Fake.Asked;
    readonly value: unknown;
  }>([
    {
      name: "start",
      call: (qemu) => qemu.start({ iso: ISO, resume: false }),
      reply: OK,
      asked: posted("start", { iso: ISO, mode: "fresh" }),
      value: undefined,
    },
    {
      name: "a resuming start",
      call: (qemu) => qemu.start({ iso: ISO, resume: true }),
      reply: OK,
      asked: posted("start", { iso: ISO, mode: "resume" }),
      value: undefined,
    },
    { name: "image", call: (qemu) => qemu.image(), reply: png(), asked: got("image"), value: PNG },
    {
      name: "serial",
      call: (qemu) => qemu.serial(),
      reply: serial(),
      asked: got("serial"),
      value: SERIAL,
    },
    {
      name: "sendKeys",
      call: (qemu) => qemu.sendKeys("prime<ENTER>"),
      reply: OK,
      asked: posted("send-keys", { keys: "prime<ENTER>" }),
      value: undefined,
    },
    {
      name: "mouse.move",
      call: (qemu) => qemu.mouse.move(AT),
      reply: OK,
      asked: posted("mouse/move", AT),
      value: AT,
    },
    {
      name: "mouse.scroll",
      call: (qemu) => qemu.mouse.scroll(AT, "down", 3),
      reply: OK,
      asked: posted("mouse/scroll", { ...AT, direction: "down", ticks: 3 }),
      value: undefined,
    },
    {
      name: "mouse.hold",
      call: (qemu) => qemu.mouse.hold(AT, "left"),
      reply: OK,
      asked: posted("mouse/hold", { ...AT, button: "left" }),
      value: undefined,
    },
    {
      name: "mouse.release",
      call: (qemu) => qemu.mouse.release(AT, "left"),
      reply: OK,
      asked: posted("mouse/release", { ...AT, button: "left" }),
      value: undefined,
    },
    {
      name: "intentStart",
      call: (qemu) => qemu.intentStart(STEP),
      reply: OK,
      asked: posted("intent/start", { message: STEP }),
      value: undefined,
    },
    {
      name: "intentEnd",
      call: (qemu) => qemu.intentEnd(),
      reply: OK,
      asked: posted("intent/end"),
      value: undefined,
    },
    {
      name: "stop",
      call: (qemu) => qemu.stop({ status: "failed", reason: "step limit of 40 reached" }),
      reply: OK,
      asked: posted("stop", { status: "failed", reason: "step limit of 40 reached" }),
      value: undefined,
    },
    {
      name: "save",
      call: (qemu) => qemu.save(),
      reply: OK,
      asked: posted("save"),
      value: undefined,
    },
  ])(
    "$name sends its request to the proxy, naming the job, and returns its value (happy)",
    async ({ call, reply, asked, value }) => {
      const { qemu, asked: sent } = await tools(reply);

      const answer = await call(qemu);

      expect(answer).toEqual(jarl.ok(value));
      expect(sent).toEqual([asked]);
    },
  );

  it.each(EVERY_CALL)(
    "$name hands back the proxy's status error as it came (unhappy)",
    async ({ call, before }) => {
      const failed = Fake.status(503, "qemu: exchange failed");
      const { qemu } = await tools([...Array.from({ length: before }, () => OK), failed]);

      const answer = await call(qemu);

      const error = Fake.failure(answer, Http.HttpServerError);
      expect(error.status).toBe(503);
      expect(error.body).toBe("qemu: exchange failed");
    },
  );

  it.each<{
    readonly name: string;
    readonly is: string;
    readonly error: abstract new (...args: never[]) => Error;
  }>([
    ...[
      "image",
      "sendKeys",
      "mouse.move",
      "mouse.nudge",
      "mouse.click",
      "mouse.doubleClick",
      "mouse.drag",
      "mouse.scroll",
      "mouse.hold",
      "mouse.release",
    ].map((name) => ({ name, is: "GuestOff", error: QemuHttpTools.GuestOff })),
    { name: "intentStart", is: "IntentOpen", error: QemuHttpTools.IntentOpen },
    { name: "save", is: "NotPoweredOff", error: QemuHttpTools.NotPoweredOff },
    ...["start", "serial", "intentEnd", "stop"].map((name) => ({
      name,
      is: "HttpUnhandled",
      error: Http.HttpUnhandled,
    })),
  ])("a 409 on $name is $is, with the proxy's message (unhappy)", async ({ name, error }) => {
    const { call, before } = byName(name);
    const conflict = Fake.status(409, "qemu: the guest said no");
    const { qemu } = await tools([...Array.from({ length: before }, () => OK), conflict]);

    const answer = await call(qemu);

    expect(Fake.failure(answer, error).message).toContain("qemu: the guest said no");
  });

  it("an image answered with no bytes is HttpInvalid (unhappy)", async () => {
    const { qemu } = await tools(
      new Response(new Uint8Array(), { headers: { "Content-Type": "image/png" } }),
    );

    const image = await qemu.image();

    expect(Fake.failure(image, Http.HttpInvalid).reason).toBe("no image");
  });

  it.each([
    {
      name: "start, which may download its ISO first,",
      call: (qemu: QemuHttpTools.QemuHttpTools) => qemu.start({ iso: ISO, resume: false }),
      ms: 45 * 60_000,
    },
    {
      name: "save, which gives the guest two minutes to power off,",
      call: (qemu: QemuHttpTools.QemuHttpTools) => qemu.save(),
      ms: 5 * 60_000,
    },
    {
      name: "image, as every other call,",
      call: (qemu: QemuHttpTools.QemuHttpTools) => qemu.image(),
      ms: DEFAULT_TIMEOUT_MS,
    },
  ])("$name waits $ms ms for an answer, then is HttpTimedOut (unhappy)", async ({ call, ms }) => {
    const { qemu } = await tools("hang");
    vi.useFakeTimers();
    let settled = false;

    const answer = call(qemu).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(Fake.failure(await answer, Http.HttpTimedOut).message).toContain(
      `no answer within ${String(ms)} ms`,
    );
  });

  it("the run's signal aborting ends a call as Aborted, and stop still ends the guest (unhappy)", async () => {
    const controller = new AbortController();
    const { qemu, asked } = await tools(["hang", OK], { signal: controller.signal });

    const image = qemu.image();
    controller.abort(new Async.Aborted("job aborted"));
    const stopped = await qemu.stop({ status: "aborted", reason: "job aborted" });

    expect(Fake.failure(await image, Async.Aborted).message).toBe("job aborted");
    expect(stopped).toEqual(jarl.ok(undefined));
    expect(asked).toEqual([
      got("image"),
      posted("stop", { status: "aborted", reason: "job aborted" }),
    ]);
  });
});
