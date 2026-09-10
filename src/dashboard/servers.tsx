import type { FC } from "hono/jsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";
import type { AutomationJob, AutomationQueue, Server } from "./query.ts";

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
          <td>{"qemus" in server.stats ? server.stats.qemus : 0}</td>
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

const ClientRow: FC<{ server: Server }> = ({ server }) => {
  if (server.stats === null || server.heartbeatAt === null) {
    return (
      <tr>
        <td>{server.url}</td>
        <td colspan={3}>never heard from</td>
        <td>{server.generation}</td>
        <td>never</td>
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
          <td>{"agents" in server.stats ? server.stats.agents : 0}</td>
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
    </tr>
  );
};

// Automation clients as a table under the queue, or none: they announce themselves and leave
// by themselves, so there is no delete form.
export const Clients: FC<{ clients: ReadonlyArray<Server> }> = ({ clients }) => (
  <>
    <h3>clients</h3>
    {clients.length === 0 ? (
      <p>none</p>
    ) : (
      <table>
        <tr>
          <th>url</th>
          <th>agents</th>
          <th>memory</th>
          <th>cpu 1m / 2m / 3m</th>
          <th>generation</th>
          <th>heartbeat</th>
        </tr>
        {clients.map((server) => (
          <ClientRow server={server} />
        ))}
      </table>
    )}
  </>
);

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

// A stamp's age against the clock the read was made at, or a dash for a stamp not written yet.
const since = (stamp: Date | null, queriedAt: Date): string =>
  stamp === null ? "—" : `${age(queriedAt.getTime() - stamp.getTime())} ago`;

// One list of the queue as a table, or the one word that says it is empty. The columns are the
// same in every list, so a pending job shows dashes where its start and finish will go.
const Jobs: FC<{ jobs: ReadonlyArray<AutomationJob> }> = ({ jobs }) =>
  jobs.length === 0 ? (
    <p>none</p>
  ) : (
    <table>
      <tr>
        <th>ticket</th>
        <th>test</th>
        <th>action</th>
        <th>status</th>
        <th>queued</th>
        <th>started</th>
        <th>finished</th>
        <th>reason</th>
      </tr>
      {jobs.map((job) => (
        <tr>
          <td>{job.ticket ?? "—"}</td>
          <td>{job.test}</td>
          <td>{job.action}</td>
          <td>{job.status}</td>
          <td>{since(job.createdAt, job.queriedAt)}</td>
          <td>{since(job.startedAt, job.queriedAt)}</td>
          <td>{since(job.finishedAt, job.queriedAt)}</td>
          <td>{job.reason}</td>
        </tr>
      ))}
    </table>
  );

// The automation queue in the order the database sorted it: what runs, what waits, what finished.
// What the automation half polls for.
export const Queue: FC<{ queue: AutomationQueue }> = ({ queue }) => (
  <>
    <h3>running</h3>
    <Jobs jobs={queue.running} />
    <h3>pending</h3>
    <Jobs jobs={queue.pending} />
    <h3>completed</h3>
    <Jobs jobs={queue.completed} />
  </>
);

// Both halves of the page, read together: absent together when the database could not be read.
export type Halves = {
  readonly queue: AutomationQueue;
  readonly clients: ReadonlyArray<Server>;
  readonly servers: ReadonlyArray<Server>;
};

// Text an operator reads at a glance, in two halves side by side: the automation queue, then the
// qemu fleet with its add box, each swapped in fresh every thirty seconds. The one style rule is
// the split. `halves` is absent only when the database could not be read, so a 500 page claims
// neither an empty queue nor an empty fleet; `error` is the reason a request was refused, on top.
export const ServersPage: FC<{
  halves: Halves | undefined;
  error: string | undefined;
}> = ({ halves, error }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>oligarchy servers</title>
      <style>
        {
          ".halves { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; }"
        }
      </style>
      <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
    </head>
    <body>
      <h1>oligarchy servers</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      <div class="halves">
        <section>
          <h2>automation</h2>
          {halves === undefined ? null : (
            <div id="queue" hx-get="/servers/queue" hx-trigger="every 30s">
              <Queue queue={halves.queue} />
              <Clients clients={halves.clients} />
            </div>
          )}
        </section>
        <section>
          <h2>qemu servers</h2>
          {halves === undefined ? null : (
            <div id="fleet" hx-get="/servers/fleet" hx-trigger="every 30s">
              <Fleet servers={halves.servers} />
            </div>
          )}
          <h2>add a server</h2>
          <form method="post" action="/servers">
            <input name="url" size={60} placeholder="https://qemu.example.com" />
            <button>add</button>
          </form>
        </section>
      </div>
    </body>
  </html>
);
