import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// /start blocks until the ISO is fetched and QEMU boots; a first-time URL download can
// outlast fetch's 300s header timeout, which fetch does not let a caller raise per
// request. So /start goes through node:http (postStart) with this idle ceiling instead.
const START_TIMEOUT_MS = 45 * 60 * 1000;

export type Proxy = {
  serverUrl: string;
  token: string;
};

export async function postJSON(proxy: Proxy, path: string, body: unknown): Promise<string> {
  const res = await fetch(`${proxy.serverUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${proxy.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(apiError(await res.text()));
  }
  return res.text();
}

export async function getBytes(proxy: Proxy, path: string): Promise<Buffer> {
  const res = await fetch(`${proxy.serverUrl}${path}`, {
    headers: { Authorization: `Bearer ${proxy.token}` },
  });
  if (res.status !== 200) {
    throw new Error(apiError(await res.text()));
  }
  return Buffer.from(await res.arrayBuffer());
}

// /start alone can outlast fetch's fixed 300s header timeout, so it uses node:http,
// whose idle timeout is the only ceiling — the connection sits quiet while the server
// downloads the ISO and boots, then the reply arrives in one short burst.
export function postStart(proxy: Proxy, body: unknown): Promise<string> {
  const url = new URL(`${proxy.serverUrl}/start`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const payload = JSON.stringify(body);
  return new Promise<string>((resolve, reject) => {
    const req = send(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${proxy.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        // A reset mid-body emits res error but never end, so without this the promise
        // (and its timeout, gone with the destroyed socket) would hang forever.
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode!;
          if (status >= 200 && status < 300) {
            resolve(data);
          } else {
            reject(new Error(apiError(data)));
          }
        });
      },
    );
    req.setTimeout(START_TIMEOUT_MS, () => req.destroy(new Error("start: no response within timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

// A follow stays open for as long as the session lives, and fetch would cut it off after
// five quiet minutes (undici's body timeout); node:http has no such ceiling.
export function getStream(proxy: Proxy, path: string, out: NodeJS.WritableStream): Promise<void> {
  const url = new URL(`${proxy.serverUrl}${path}`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<void>((resolve, reject) => {
    const req = send(url, { headers: { Authorization: `Bearer ${proxy.token}` } }, (res) => {
      res.on("error", reject);
      if (res.statusCode !== 200) {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => reject(new Error(apiError(data))));
        return;
      }
      res.on("end", resolve);
      res.pipe(out, { end: false });
    });
    req.on("error", reject);
    req.end();
  });
}

function apiError(data: string): string {
  try {
    return (JSON.parse(data) as { error: string }).error;
  } catch {
    return data || "request failed";
  }
}
