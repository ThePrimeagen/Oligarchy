import type { FC } from "hono/jsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";
import type { Server } from "./query.ts";

// A server writes its row every thirty seconds. One heartbeat may be in flight and one lost to a
// slow database; three overdue is a server that stopped.
const SILENT_AFTER_MS = 90_000;

const gigabytes = (bytes: number): string => (bytes / 1_000_000_000).toFixed(1);

const percent = (value: number): string => `${value.toFixed(1)}%`;

// The unit an operator reads at a glance: seconds under a minute, then whole minutes, hours, days.
const age = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} h`;
  }
  return `${String(Math.floor(hours / 24))} d`;
};

// One row: what the server said of itself, or the one word that says it stopped saying it. stats
// and heartbeat_at are written together, so either being null is a row no server has claimed.
const Row: FC<{ server: Server }> = ({ server }) => {
  const remove = (
    <td>
      <form method="post" action="/servers/delete">
        <input type="hidden" name="url" value={server.url} />
        <button>delete</button>
      </form>
    </td>
  );
  if (server.stats === null || server.heartbeatAt === null) {
    return (
      <tr>
        <td>{server.url}</td>
        <td colspan={3}>never heard from</td>
        <td>{server.generation}</td>
        <td>never</td>
        {remove}
      </tr>
    );
  }
  const sinceHeartbeat = server.queriedAt.getTime() - server.heartbeatAt.getTime();
  return (
    <tr>
      <td>{server.url}</td>
      {sinceHeartbeat > SILENT_AFTER_MS ? (
        <td colspan={3}>
          <strong>silent</strong>
        </td>
      ) : (
        <>
          <td>{server.stats.qemus}</td>
          <td>
            {gigabytes(server.stats.memory.usedBytes)} / {gigabytes(server.stats.memory.totalBytes)}{" "}
            GB
          </td>
          <td>
            {percent(server.stats.cpu.mean1m)} / {percent(server.stats.cpu.mean2m)} /{" "}
            {percent(server.stats.cpu.mean3m)}
          </td>
        </>
      )}
      <td>{server.generation}</td>
      <td>{age(sinceHeartbeat)} ago</td>
      {remove}
    </tr>
  );
};

// The fleet as a table, or the sentence that there is none: what the page polls for.
export const Fleet: FC<{ servers: ReadonlyArray<Server> }> = ({ servers }) =>
  servers.length === 0 ? (
    <p>no servers registered</p>
  ) : (
    <table>
      <tr>
        <th>url</th>
        <th>qemus</th>
        <th>memory</th>
        <th>cpu 1m / 2m / 3m</th>
        <th>generation</th>
        <th>heartbeat</th>
        <th></th>
      </tr>
      {servers.map((server) => (
        <Row server={server} />
      ))}
    </table>
  );

// Unstyled on purpose: text an operator reads at a glance, the fleet swapped in fresh every
// thirty seconds. `servers` is absent only when the database could not be read, so a 500 page
// does not claim an empty fleet; `error` is the reason a request was refused, on top.
export const ServersPage: FC<{
  servers: ReadonlyArray<Server> | undefined;
  error: string | undefined;
}> = ({ servers, error }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>oligarchy servers</title>
      <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
    </head>
    <body>
      <h1>oligarchy servers</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      <h2>servers</h2>
      {servers === undefined ? null : (
        <div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s">
          <Fleet servers={servers} />
        </div>
      )}
      <h2>add a server</h2>
      <form method="post" action="/servers">
        <input name="url" size={60} placeholder="https://qemu.example.com" />
        <button>add</button>
      </form>
    </body>
  </html>
);
