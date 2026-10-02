import * as Net from "node:net";
import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import { type Answer, failed, QemuFailed, check } from "./errors.ts";
import * as Queue from "./queue.ts";
export type Socket = {
  readonly read: (signal: AbortSignal) => Answer<string | undefined>;
  readonly write: (line: string) => Answer<void>;
  readonly close: () => void;
};
export type Listener = {
  readonly accept: (signal: AbortSignal) => Answer<Socket>;
  readonly close: () => Promise<void>;
};
export type QmpListen = {
  readonly service: "qmpListen";
  readonly listen: (path: string) => Answer<Listener>;
};
declare module "@oligarchy/app" {
  interface Services {
    qmpListen: App.Register<"qmpListen", QmpListen>;
  }
}
export type Options = { readonly createServer?: typeof Net.createServer; readonly backlog: number };
export const create = App.createService<never, Options, QmpListen>((_, options) => ({
  service: "qmpListen",
  listen: (path) =>
    jarl.exec(async () => {
      const connections = Queue.create<Socket>(1);
      const sockets = new Set<Net.Socket>();
      let accepted = false;
      const server = (options.createServer ?? Net.createServer)((socket) => {
        if (accepted) {
          socket.destroy();
          return;
        }
        accepted = true;
        sockets.add(socket);
        const chunks = Queue.create<string>(options.backlog);
        socket.setEncoding("utf8");
        socket.on("data", (data: string) => {
          if (!chunks.push(data)) socket.destroy();
        });
        socket.on("error", (error) => chunks.finish(failed(error)));
        socket.on("close", () => {
          sockets.delete(socket);
          chunks.finish();
        });
        connections.push({
          read: chunks.read,
          write: (line) =>
            jarl.exec(
              () =>
                new Promise<void>((resolve, reject) => {
                  if (socket.destroyed) {
                    reject(new QemuFailed("QMP socket closed"));
                    return;
                  }
                  socket.write(line, (error) => (error ? reject(error) : resolve()));
                }),
              failed,
            ),
          close: () => socket.destroy(),
        });
      });
      server.on("error", (error) => connections.finish(failed(error)));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return {
        accept: (signal) =>
          jarl.exec(async () => {
            check(signal);
            const socket = jarl.unwrap(await connections.read(signal));
            if (socket === undefined) throw new QemuFailed("QMP listener closed");
            return socket;
          }, failed),
        close: async () => {
          connections.finish(new QemuFailed("QMP listener closed"));
          for (const socket of sockets) socket.destroy();
          if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        },
      } satisfies Listener;
    }, failed),
}));
