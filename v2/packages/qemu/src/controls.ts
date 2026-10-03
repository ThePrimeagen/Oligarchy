import * as jarl from "jarl";
import * as Async from "@oligarchy/async";
import type * as Qmp from "./qmp.ts";
import { type Answer, failed } from "./errors.ts";
export type Point = { readonly x: number; readonly y: number };
export type Mouse = {
  readonly kind: string;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly from?: Point | undefined;
  readonly to?: Point | undefined;
  readonly button?: string | undefined;
  readonly direction?: string | undefined;
  readonly ticks?: number | undefined;
  readonly modifiers?: readonly string[] | undefined;
};
export const mouse = (
  client: Qmp.Qmp,
  signal: AbortSignal,
  gesture: Mouse,
  record: Qmp.Recorder,
  timing: { clickGap: number; dragGap: number; dragSteps: number },
): Answer<void> =>
  jarl.exec(async () => {
    const at = (point: Point) => [
      { type: "abs", data: { axis: "x", value: Math.round(point.x * 0x7fff) } },
      { type: "abs", data: { axis: "y", value: Math.round(point.y * 0x7fff) } },
    ];
    const button = (name: string, down: boolean) => ({ type: "btn", data: { button: name, down } });
    const send = (events: unknown[], cleanup = false) =>
      client.execute(
        { execute: "input-send-event", arguments: { events } },
        cleanup ? new AbortController().signal : signal,
        record,
      );
    const point = { x: gesture.x ?? 0, y: gesture.y ?? 0 };
    const name = gesture.button ?? "left";
    const modifiers = (gesture.modifiers ?? []).map((key) => ({
      type: "key",
      data: { down: true, key: { type: "qcode", data: key === "super" ? "meta_l" : key } },
    }));
    try {
      if (modifiers.length) jarl.unwrap(await send(modifiers));
      switch (gesture.kind) {
        case "move":
          jarl.unwrap(await send(at(point)));
          break;
        case "hold":
        case "release":
          jarl.unwrap(await send([...at(point), button(name, gesture.kind === "hold")]));
          break;
        case "drag": {
          const from = gesture.from!;
          const to = gesture.to!;
          try {
            jarl.unwrap(await send([...at(from), button(name, true)]));
            for (let step = 1; step <= timing.dragSteps; step++) {
              jarl.unwrap(await Async.sleep(timing.dragGap, signal));
              jarl.unwrap(
                await send(
                  at({
                    x: from.x + ((to.x - from.x) * step) / timing.dragSteps,
                    y: from.y + ((to.y - from.y) * step) / timing.dragSteps,
                  }),
                ),
              );
            }
          } finally {
            jarl.unwrap(await send([...at(to), button(name, false)], true));
          }
          break;
        }
        default: {
          let count = 1;
          if (gesture.kind === "scroll") count = gesture.ticks!;
          else if (gesture.kind === "double-click") count = 2;
          const key = gesture.kind === "scroll" ? `wheel-${gesture.direction}` : name;
          for (let n = 0; n < count; n++) {
            try {
              jarl.unwrap(await send([...at(point), button(key, true)]));
            } finally {
              jarl.unwrap(await send([button(key, false)], true));
            }
            if (n + 1 < count) jarl.unwrap(await Async.sleep(timing.clickGap, signal));
          }
        }
      }
    } finally {
      if (modifiers.length)
        jarl.unwrap(
          await send(
            modifiers
              .reverse()
              .map((event) => ({ ...event, data: { ...event.data, down: false } })),
            true,
          ),
        );
    }
  }, failed);
