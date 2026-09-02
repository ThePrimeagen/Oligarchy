type Env = {
  ORIGIN: { get(key: string): Promise<string | null> };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const origin = await env.ORIGIN.get("url");
      if (origin === null || origin === "") {
        return Response.json({ error: "runner origin is not registered" }, { status: 503 });
      }
      const incoming = new URL(request.url);
      const target = new URL(incoming.pathname + incoming.search, origin);
      const headers = new Headers(request.headers);
      headers.set("host", target.host);
      return await fetch(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 });
    }
  },
};
