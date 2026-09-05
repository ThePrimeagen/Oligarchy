import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { deflateSync } from "node:zlib";

// A node:http stand-in for the proxy, for the integration lane: it records every request and
// answers from a script. Port of the stubs in v1/src/{client,ctrl,session}.test.ts.

export type Received = {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
};

export type Reply = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  // Sent in one piece.
  readonly body?: string | Uint8Array | undefined;
  // Sent one at a time, `intervalMs` apart (0 when omitted).
  readonly chunks?: ReadonlyArray<string> | undefined;
  readonly intervalMs?: number | undefined;
  // `false` keeps the response open until the server closes.
  readonly end?: boolean | undefined;
};

export type Script = (received: Received) => Reply;

export type StubProxy = {
  readonly url: string;
  readonly requests: Array<Received>;
  readonly close: () => Promise<void>;
};

export const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";
export const FOLLOWED_ID = "7a2d0000-0000-4000-8000-00000000f011";
export const ENDED_ID = "8b3e0000-0000-4000-8000-00000000a1c2";
export const DROPPED_ID = "5d0a0000-0000-4000-8000-00000000c3e4";
export const ENDLESS_ID = "4e1b0000-0000-4000-8000-00000000d4f5";
export const IMAGE_ID = "9c4f0000-0000-4000-8000-00000000b2d3";

export const OK: Reply = { status: 200, body: '{"ok":"true"}' };

export const json = (status: number, body: unknown): Reply => ({
  status,
  body: JSON.stringify(body),
});

export const refusal = (status: number, message: string): Reply => json(status, { error: message });

// A 2x2 8-bit RGB PNG, the shape QEMU's screendump writes: red, green / blue, white.
export const tinyPng = (): Uint8Array => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
};

const line = (event: unknown): string => `${JSON.stringify(event)}\n`;

// The three lines the client tests follow.
export const FOLLOW_LINES: ReadonlyArray<string> = [
  line({ type: "session", status: "running" }),
  line({ type: "action", id: 1, name: "send-keys", state: "running" }),
  line({ type: "session", status: "succeeded" }),
];

// The tour the session view tests follow.
export const FOLLOWED_LINES: ReadonlyArray<string> = [
  { type: "session", status: "pending" },
  { type: "session", status: "running" },
  { type: "intent", state: "started", message: "wait for the boot menu" },
  { type: "action", id: 1, name: "send-keys", state: "running" },
  { type: "action", id: 1, state: "completed" },
  { type: "action", id: 2, name: "get-image", state: "running" },
  { type: "image", id: IMAGE_ID, png: Buffer.from(tinyPng()).toString("base64") },
  { type: "action", id: 2, state: "completed" },
  { type: "action", id: 3, name: "send-mouse", state: "running" },
  { type: "action", id: 3, state: "failed" },
  { type: "intent", state: "completed" },
  { type: "action", id: 4, name: "get-serial", state: "running" },
  { type: "action", id: 4, state: "completed" },
  { type: "session", status: "succeeded" },
].map(line);

const NDJSON = { "Content-Type": "application/x-ndjson" };

const bodyText = (body: unknown): string => (typeof body === "string" ? body : "");

export const defaultScript: Script = (received) => {
  const { pathname, searchParams } = new URL(received.url, "http://stub");
  if (pathname === "/start") {
    return json(200, { id: SESSION_ID });
  }
  if (pathname === "/image") {
    return {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "x-image-url": `https://oligarchy.trm.sh/images/${IMAGE_ID}`,
      },
      body: tinyPng(),
    };
  }
  if (pathname === "/serial") {
    return { status: 200, headers: { "Content-Type": "text/plain" }, body: "boot log\n" };
  }
  if (pathname === "/dump") {
    return {
      status: 200,
      headers: { "Content-Type": "text/plain" },
      body: "[    0.000000] Linux version 6.12\nkernel panic - not syncing\n",
    };
  }
  if (pathname === "/follow") {
    switch (searchParams.get("id")) {
      case DROPPED_ID:
        return { status: 200, headers: NDJSON, body: line({ type: "session", status: "running" }) };
      case ENDLESS_ID:
        return {
          status: 200,
          headers: NDJSON,
          body:
            line({ type: "session", status: "running" }) +
            line({ type: "intent", state: "started", message: "still going" }),
          end: false,
        };
      case ENDED_ID:
        return refusal(409, `session "${ENDED_ID}" has already completed (succeeded)`);
      case FOLLOWED_ID:
        return { status: 200, headers: NDJSON, chunks: FOLLOWED_LINES, intervalMs: 60 };
      default:
        return { status: 200, headers: NDJSON, chunks: FOLLOW_LINES, intervalMs: 60 };
    }
  }
  if (pathname === "/intent/start" && bodyText(received.body).includes("second")) {
    return refusal(
      500,
      "Cannot start one intent when one's already running. Please end your previous intent.",
    );
  }
  return OK;
};

const parseBody = (text: string): unknown => {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const writeChunks = (
  response: ServerResponse,
  chunks: ReadonlyArray<string>,
  intervalMs: number,
  end: boolean,
): void => {
  let index = 0;
  const tick = () => {
    const chunk = chunks[index];
    if (chunk !== undefined) {
      response.write(chunk);
      index += 1;
    }
    if (index < chunks.length) {
      setTimeout(tick, intervalMs);
    } else if (end) {
      response.end();
    }
  };
  tick();
};

// `end: false` leaves the response open; `close` destroys the socket under it.
const answer = (response: ServerResponse, reply: Reply): void => {
  response.writeHead(reply.status, { "Content-Type": "application/json", ...reply.headers });
  const end = reply.end ?? true;
  if (reply.chunks !== undefined) {
    writeChunks(response, reply.chunks, reply.intervalMs ?? 0, end);
    return;
  }
  if (reply.body !== undefined) {
    response.write(reply.body);
  }
  if (end) {
    response.end();
  }
};

export const startStubProxy = async (script: Script = defaultScript): Promise<StubProxy> => {
  const requests: Array<Received> = [];
  const sockets = new Set<Socket>();
  const server = createServer((incoming, response) => {
    let text = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (data: string) => {
      text += data;
    });
    incoming.on("end", () => {
      const received: Received = {
        method: incoming.method ?? "",
        url: incoming.url ?? "",
        authorization: incoming.headers.authorization,
        body: parseBody(text),
      };
      requests.push(received);
      answer(response, script(received));
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub proxy: no tcp address");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        for (const socket of sockets) {
          socket.destroy();
        }
      }),
  };
};
