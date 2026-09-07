import { once } from "node:events";
import { createServer, type Server } from "node:http";

export type CursorRequest = {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
};

export type StubCursor = {
  readonly url: string;
  readonly requests: Array<CursorRequest>;
  readonly close: () => Promise<void>;
};

export const RUN_ID = "run-22222222-2222-4222-8222-222222222222";

const readBody = (incoming: import("node:http").IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (data: string) => {
      body += data;
    });
    incoming.on("end", () => resolve(body));
  });

// A stand-in for api.cursor.com that @cursor/sdk reaches through CURSOR_BACKEND_URL: it lists one
// model and creates whatever agent it is asked for, echoing the id the SDK minted.
export const startStubCursor = async (
  options: { readonly models?: ReadonlyArray<string> } = {},
): Promise<StubCursor> => {
  const requests: Array<CursorRequest> = [];
  const models = options.models ?? ["grok-4.6"];
  const server: Server = createServer((incoming, response) => {
    void readBody(incoming).then((body) => {
      requests.push({
        method: incoming.method,
        url: incoming.url,
        authorization: incoming.headers.authorization,
        body,
      });
      if (incoming.method === "GET" && incoming.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            items: models.map((id) => ({ id, displayName: `Cursor ${id}` })),
          }),
        );
        return;
      }
      if (incoming.method === "POST" && incoming.url === "/v1/agents") {
        const parsed: { agentId?: string } = JSON.parse(body);
        const agentId = parsed.agentId ?? "bc-00000000-0000-4000-8000-000000000000";
        const now = new Date().toISOString();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            agent: {
              id: agentId,
              status: "ACTIVE",
              url: `https://cursor.com/agents/${agentId}`,
              createdAt: now,
              updatedAt: now,
              latestRunId: RUN_ID,
            },
            run: { id: RUN_ID, agentId, status: "CREATING", createdAt: now, updatedAt: now },
          }),
        );
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub cursor did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
};

export const createdAgents = (stub: StubCursor): ReadonlyArray<CursorRequest> =>
  stub.requests.filter((request) => request.method === "POST" && request.url === "/v1/agents");
