import * as z from "zod";
import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import type { Socket } from "./qmp-listen.ts";
import { type Answer, type Failure, QemuFailed, failed, check } from "./errors.ts";
export type Command = {
  readonly execute: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly id?: number;
};
export type Event = { readonly event: string; readonly data?: Record<string, unknown> };
export type Recorder = (
  command: Command,
) => Answer<(outcome: { state: "completed" | "failed"; response: unknown }) => Answer<void>>;
export type Options = {
  readonly handshakeMs: number;
  readonly commandMs: number;
  readonly maxFrame: number;
  readonly event: (event: Event) => void;
};

class Qmp {
  readonly socket: Socket;
  readonly options: Options;
  readonly controller = new AbortController();
  readonly pending = new Map<number, (answer: jarl.Result<unknown, Failure>) => void>();
  readonly greeting: Promise<jarl.Result<void, Failure>>;
  greet!: (answer: jarl.Result<void, Failure>) => void;
  next = 0;
  ended: Failure | undefined;
  readonly reading: Promise<void>;
  constructor(socket: Socket, options: Options) {
    this.socket = socket;
    this.options = options;
    this.greeting = new Promise((resolve) => {
      this.greet = resolve;
    });
    this.reading = this.readLoop();
  }
  stop(error = new QemuFailed("QMP closed")): void {
    if (this.ended !== undefined) return;
    this.ended = error;
    this.controller.abort(new Async.Aborted(error.message));
    this.socket.close();
    this.greet(jarl.err(error));
    for (const resolve of this.pending.values()) resolve(jarl.err(error));
    this.pending.clear();
  }
  async readLoop(): Promise<void> {
    let buffer = "";
    while (!this.controller.signal.aborted) {
      const read = await this.socket.read(this.controller.signal);
      if (jarl.is_err(read)) {
        this.stop(new QemuFailed(read.error.message));
        return;
      }
      const text = jarl.value(read);
      if (text === undefined) {
        this.stop();
        return;
      }
      buffer += text;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        if (newline > this.options.maxFrame) {
          this.stop(new QemuFailed("QMP frame too large"));
          return;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "") continue;
        try {
          const message = z.record(z.string(), z.unknown()).parse(JSON.parse(line));
          if (message === null || typeof message !== "object") throw new Error("invalid QMP frame");
          if ("QMP" in message) this.greet(jarl.ok(undefined));
          else if (typeof message.event === "string") {
            const data =
              message.data === undefined
                ? undefined
                : z.record(z.string(), z.unknown()).parse(message.data);
            this.options.event({ event: message.event, ...(data === undefined ? {} : { data }) });
          } else if (typeof message.id === "number") {
            const resolve = this.pending.get(message.id);
            this.pending.delete(message.id);
            resolve?.(
              "error" in message
                ? jarl.err(new QemuFailed(JSON.stringify(message.error)))
                : jarl.ok(message),
            );
          }
        } catch (error) {
          this.stop(new QemuFailed(`invalid QMP frame: ${String(error)}`));
          return;
        }
      }
      if (buffer.length > this.options.maxFrame) {
        this.stop(new QemuFailed("QMP frame too large"));
        return;
      }
    }
  }
  execute(request: Command, signal: AbortSignal, record?: Recorder): Answer<unknown> {
    return jarl.exec(async () => {
      check(signal);
      if (this.ended !== undefined) throw this.ended;
      const command = { ...request, id: ++this.next };
      const close = record === undefined ? undefined : jarl.unwrap(await record(command));
      const result = await Async.timeout(
        async (inner): Answer<unknown> => {
          if (inner.aborted) return jarl.err(new Async.Aborted("QMP command aborted"));
          const reply = new Promise<jarl.Result<unknown, Failure>>((resolve) => {
            this.pending.set(command.id, resolve);
          });
          const abort = () => {
            this.pending.get(command.id)?.(jarl.err(new Async.Aborted("QMP command aborted")));
            this.pending.delete(command.id);
          };
          inner.addEventListener("abort", abort, { once: true });
          try {
            const written = await this.socket.write(`${JSON.stringify(command)}\r\n`);
            if (jarl.is_err(written)) return written;
            return await reply;
          } finally {
            inner.removeEventListener("abort", abort);
            this.pending.delete(command.id);
          }
        },
        { ms: this.options.commandMs, signal },
      );
      if (close !== undefined) {
        const recorded = await close({
          state: jarl.is_err(result) ? "failed" : "completed",
          response: jarl.is_err(result) ? result.error.message : jarl.value(result),
        });
        if (jarl.is_ok(result)) jarl.unwrap(recorded);
      }
      return jarl.unwrap(result);
    }, failed);
  }
}
export type { Qmp };
export const create = (
  socket: Socket,
  signal: AbortSignal,
  options: Options,
  record?: Recorder,
): Answer<Qmp> =>
  jarl.exec(async () => {
    const client = new Qmp(socket, options);
    const greeting = await Async.timeout(
      async (inner): Answer<void> => {
        if (inner.aborted) return jarl.err(new Async.Aborted("QMP handshake aborted"));
        const abort = () => client.stop(new QemuFailed("QMP handshake aborted"));
        inner.addEventListener("abort", abort, { once: true });
        try {
          return await client.greeting;
        } finally {
          inner.removeEventListener("abort", abort);
        }
      },
      { ms: options.handshakeMs, signal },
    );
    if (jarl.is_err(greeting)) {
      client.stop();
      throw greeting.error;
    }
    const enabled = await client.execute(
      { execute: "qmp_capabilities", arguments: {} },
      signal,
      record,
    );
    if (jarl.is_err(enabled)) {
      client.stop();
      throw enabled.error;
    }
    return client;
  }, failed);
