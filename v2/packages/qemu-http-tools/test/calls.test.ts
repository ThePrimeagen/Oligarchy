import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as QemuHttpTools from "../src/main.ts";
import { got, OK, posted, SAVE_TIMEOUT_MS, START_TIMEOUT_MS, tools } from "./support.ts";

type Call = (qemu: QemuHttpTools.QemuHttpTools) => Promise<jarl.Result<unknown, unknown>>;

const ISO = "https://iso.omarchy.org/omarchy-3.1.iso";
const STEP = "Press Super+Escape. The System menu opens.";

describe("calls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The guest's screen, keys and mouse are sent through the tools; see tools.test.ts.
  it.each<{ readonly name: string; readonly call: Call; readonly asked: Fake.Asked }>([
    {
      name: "start",
      call: (qemu) => qemu.start({ iso: ISO, resume: false }),
      asked: posted("start", { iso: ISO, mode: "fresh" }),
    },
    {
      name: "a resuming start",
      call: (qemu) => qemu.start({ iso: ISO, resume: true }),
      asked: posted("start", { iso: ISO, mode: "resume" }),
    },
    {
      name: "intentStart",
      call: (qemu) => qemu.intentStart(STEP),
      asked: posted("intent/start", { message: STEP }),
    },
    { name: "intentEnd", call: (qemu) => qemu.intentEnd(), asked: posted("intent/end") },
    {
      name: "stop",
      call: (qemu) => qemu.stop({ status: "failed", reason: "step limit of 40 reached" }),
      asked: posted("stop", { status: "failed", reason: "step limit of 40 reached" }),
    },
    { name: "save", call: (qemu) => qemu.save(), asked: posted("save") },
  ])("$name sends its request to the proxy, naming the job (happy)", async ({ call, asked }) => {
    const { qemu, asked: sent } = await tools(OK);

    const answer = await call(qemu);

    expect(answer).toEqual(jarl.ok(undefined));
    expect(sent).toEqual([asked]);
  });

  it.each<{
    readonly name: string;
    readonly call: Call;
    readonly before: number;
    readonly is: string;
    readonly error: abstract new (...args: never[]) => Error;
  }>([
    {
      name: "image",
      call: (qemu) => qemu.image(),
      before: 0,
      is: "GuestOff",
      error: QemuHttpTools.GuestOff,
    },
    {
      name: "a key or mouse call",
      call: async (qemu) => {
        await qemu.mouse.move({ x: 0.5, y: 0.5 });
        return qemu.mouse.click("left");
      },
      before: 1,
      is: "GuestOff",
      error: QemuHttpTools.GuestOff,
    },
    {
      name: "intentStart",
      call: (qemu) => qemu.intentStart(STEP),
      before: 0,
      is: "IntentOpen",
      error: QemuHttpTools.IntentOpen,
    },
    {
      name: "save",
      call: (qemu) => qemu.save(),
      before: 0,
      is: "NotPoweredOff",
      error: QemuHttpTools.NotPoweredOff,
    },
    {
      name: "stop, which names no conflict of its own,",
      call: (qemu) => qemu.stop({ status: "failed" }),
      before: 0,
      is: "HttpUnhandled",
      error: Http.HttpUnhandled,
    },
  ])(
    "a 409 on $name is $is, with the proxy's message (unhappy)",
    async ({ call, before, error }) => {
      const conflict = Fake.status(409, "qemu: the guest said no");
      const { qemu } = await tools([...Array.from({ length: before }, () => OK), conflict]);

      const answer = await call(qemu);

      expect(Fake.failure(answer, error).message).toContain("qemu: the guest said no");
    },
  );

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
      ms: START_TIMEOUT_MS,
    },
    {
      name: "save, which gives the guest time to power off,",
      call: (qemu: QemuHttpTools.QemuHttpTools) => qemu.save(),
      ms: SAVE_TIMEOUT_MS,
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
