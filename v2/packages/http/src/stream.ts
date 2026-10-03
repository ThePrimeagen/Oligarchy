import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import { HttpTimedOut, HttpUnreachable } from "./failure.ts";
import type { Fetch, Init } from "./main.ts";

export type Failure = HttpTimedOut | HttpUnreachable | Async.Aborted;
export type HttpResponse = {
  readonly status: number;
  readonly headers: Headers;
  readonly read: () => Promise<jarl.Result<Uint8Array | undefined, Failure>>;
  readonly close: () => Promise<void>;
};

// The deadline belongs to the response until EOF or close, even when nobody is reading.
export const opening =
  (fetch: Fetch, timeoutMs: number) =>
  async (url: string, init: Init): Promise<jarl.Result<HttpResponse, Failure>> => {
    const { timeoutMs: ms = timeoutMs, signal, ...rest } = init;
    const asked = { method: init.method ?? "GET", url: url.split(/[?#]/, 1)[0] ?? url };
    const controller = new AbortController();
    let failure: Failure | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let ended = false;
    let interrupted!: (result: jarl.Result<never, Failure>) => void;
    const interruption = new Promise<jarl.Result<never, Failure>>((resolve) => {
      interrupted = resolve;
    });
    const dispose = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };
    const stop = (reason: Failure) => {
      if (ended) return;
      failure = reason;
      ended = true;
      dispose();
      interrupted(jarl.err(reason));
      controller.abort(reason);
      void reader?.cancel(reason).catch(() => {});
    };
    const aborted = () =>
      stop(
        signal != null && jarl.error.is(signal.reason, Async.Aborted)
          ? signal.reason
          : new Async.Aborted("aborted"),
      );
    const timer = setTimeout(() => stop(new HttpTimedOut(asked, ms)), ms);
    if (signal?.aborted) aborted();
    else signal?.addEventListener("abort", aborted, { once: true });
    if (failure !== undefined) return jarl.err(failure);
    const sent = jarl.exec(
      async () => {
        const response = await fetch(url, { ...rest, timeout: false, signal: controller.signal });
        reader = response.body?.getReader();
        if (ended) await reader?.cancel(failure);
        return response;
      },
      (cause) => new HttpUnreachable(asked, cause),
    );
    const opened = await Promise.race([sent, interruption]);
    if (jarl.is_err(opened)) {
      dispose();
      return opened;
    }
    const response = jarl.value(opened);
    return jarl.ok({
      status: response.status,
      headers: response.headers,
      read: async () => {
        if (failure !== undefined) return jarl.err(failure);
        if (ended) return jarl.ok(undefined);
        const read = jarl.exec(
          async () => {
            const chunk = await reader?.read();
            if (chunk === undefined || chunk.done) {
              ended = true;
              dispose();
              return undefined;
            }
            return chunk.value;
          },
          (cause) => new HttpUnreachable(asked, cause),
        );
        const result = await Promise.race([read, interruption]);
        if (jarl.is_err(result)) stop(result.error);
        return result;
      },
      close: async () => {
        stop(new Async.Aborted("response closed"));
        dispose();
      },
    });
  };

// Native response boundary: an upstream failure fails the outgoing stream.
export const body = (response: HttpResponse): ReadableStream<Uint8Array> =>
  new ReadableStream({
    async pull(controller) {
      const read = await response.read();
      if (jarl.is_err(read)) {
        controller.error(read.error);
        return;
      }
      const chunk = jarl.value(read);
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel: () => response.close(),
  });
