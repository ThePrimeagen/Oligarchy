import { createServer, type RequestListener } from "node:http";
import { getRequestListener } from "@hono/node-server";
import * as jarl from "jarl";

export const ListenFailed = jarl.error.define("ListenFailed");
export type ListenFailed = InstanceType<typeof ListenFailed>;

export type Listening = {
  // Stops taking connections, ends the open ones, and settles once the listener is closed.
  readonly close: () => Promise<void>;
};

export type CreateServer = (listener: RequestListener) => {
  readonly once: (event: "error", handler: (cause: unknown) => void) => void;
  readonly off: (event: "error", handler: (cause: unknown) => void) => void;
  readonly listen: (port: number, hostname: string, listening: () => void) => void;
  readonly close: (closed: () => void) => void;
  readonly closeAllConnections: () => void;
};

const reasonOf = (cause: unknown): string => {
  if (!(cause instanceof Error)) {
    return String(cause);
  }
  const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
  return code === undefined || cause.message.includes(code)
    ? cause.message
    : `${code}: ${cause.message}`;
};

// Serves fetch on hostname:port. A port that cannot be bound is ListenFailed, naming the address
// and the reason.
export const listen = (
  fetch: (request: Request) => Response | Promise<Response>,
  options: {
    readonly hostname: string;
    readonly port: number;
    readonly createServer?: CreateServer;
  },
): Promise<jarl.Result<Listening, ListenFailed>> =>
  new Promise((resolve) => {
    const { hostname, port } = options;
    const start: CreateServer = options.createServer ?? createServer;
    const server = start(getRequestListener(fetch));
    const failed = (cause: unknown) => {
      resolve(
        jarl.err(
          new ListenFailed(`could not listen on ${hostname}:${String(port)}: ${reasonOf(cause)}`),
        ),
      );
    };
    server.once("error", failed);
    server.listen(port, hostname, () => {
      server.off("error", failed);
      resolve(
        jarl.ok({
          close: () =>
            new Promise<void>((closed) => {
              server.close(() => closed());
              server.closeAllConnections();
            }),
        }),
      );
    });
  });
