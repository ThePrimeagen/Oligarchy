import type { FC } from "hono/jsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";
import type { AutomationJob, AutomationQueue, ProcessSeries, Server } from "./query.ts";

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
        <td>{server.name ?? "—"}</td>
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
      <td>{server.name ?? "—"}</td>
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

const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);

const yOf = (value: number, max: number): number => (max === 0 ? 100 : 100 - (value / max) * 100);

// One series as SVG line segments, oldest on the left. A single sample spans the plot so it
// stays visible; a zero max sits on the baseline rather than inventing a height.
const SeriesLine: FC<{
  kind: "jobs" | "cpu";
  values: ReadonlyArray<number>;
  max: number;
}> = ({ kind, values, max }) => {
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    const y = yOf(values[0] ?? 0, max);
    return (
      <line
        class={`process-graph__${kind}`}
        x1="0"
        y1={y}
        x2="100"
        y2={y}
        vector-effect="non-scaling-stroke"
      ></line>
    );
  }
  const last = values.length - 1;
  return (
    <>
      {values.slice(1).map((value, index) => (
        <line
          class={`process-graph__${kind}`}
          x1={(index / last) * 100}
          y1={yOf(values[index] ?? 0, max)}
          x2={((index + 1) / last) * 100}
          y2={yOf(value, max)}
          vector-effect="non-scaling-stroke"
        ></line>
      ))}
    </>
  );
};

// Memory as bars, jobs and cpu as lines on the same plot. Each metric scales on its own
// (cpu against 100 percent, or higher when a sample is), oldest on the left.
const CombinedGraph: FC<{ series: ProcessSeries }> = ({ series }) => {
  const jobs = series.samples.map((sample) => sample.jobs);
  const cpu = series.samples.map((sample) => sample.cpuPercent);
  const memory = series.samples.map((sample) => sample.memoryBytes);
  const jobsMax = jobs.reduce((max, value) => (value > max ? value : max), 0);
  const cpuMax = cpu.reduce((max, value) => (value > max ? value : max), 100);
  const memoryMax = memory.reduce((max, value) => (value > max ? value : max), 0);
  const current = `jobs ${String(series.jobs)} · cpu ${percent(series.cpuPercent)} · memory ${megabytes(series.memoryBytes)} MB`;
  return (
    <div class="process-graph" role="img" aria-label={current}>
      <p class="process-graph__legend">
        <span class="process-graph__jobs">jobs {series.jobs}</span>
        {" · "}
        <span class="process-graph__cpu">cpu {percent(series.cpuPercent)}</span>
        {" · "}
        <span class="process-graph__memory">memory {megabytes(series.memoryBytes)} MB</span>
      </p>
      <div class="process-graph__plot">
        <div class="process-graph__bars">
          {memory.map((value) => (
            <span
              class="process-graph__bar"
              style={{ height: memoryMax === 0 ? "0%" : `${String((value / memoryMax) * 100)}%` }}
            ></span>
          ))}
        </div>
        <svg
          class="process-graph__lines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <SeriesLine kind="jobs" values={jobs} max={jobsMax} />
          <SeriesLine kind="cpu" values={cpu} max={cpuMax} />
        </svg>
      </div>
    </div>
  );
};

const ProcessCard: FC<{ series: ProcessSeries }> = ({ series }) => {
  const sinceReport = series.queriedAt.getTime() - series.reportedAt.getTime();
  return (
    <article class="process-card">
      <h3>{series.name}</h3>
      <p>
        {series.type} · {age(sinceReport)} ago
      </p>
      {sinceReport > SILENT_AFTER_MS ? (
        <p>
          <strong>silent</strong>
        </p>
      ) : (
        <CombinedGraph series={series} />
      )}
    </article>
  );
};

// Current process readings as one card per name: one graph of jobs, cpu and memory, or the
// sentence that there are none. What the page polls for.
export const Process: FC<{ series: ReadonlyArray<ProcessSeries> }> = ({ series }) =>
  series.length === 0 ? (
    <p>no process stats</p>
  ) : (
    <>
      {series.map((row) => (
        <ProcessCard series={row} />
      ))}
    </>
  );

// The fleet as a table, or the sentence that there is none: what the page polls for.
export const Fleet: FC<{ servers: ReadonlyArray<Server> }> = ({ servers }) =>
  servers.length === 0 ? (
    <p>no servers registered</p>
  ) : (
    <table>
      <tr>
        <th>name</th>
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
        <th></th>
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
          <td>
            {job.status === "running" && job.ticket !== null ? (
              <form
                method="post"
                action="/abort"
                hx-post="/abort"
                hx-confirm="are you sure?"
                hx-target="#queue"
                hx-swap="innerHTML"
              >
                <input type="hidden" name="ticket" value={job.ticket} />
                <button type="submit" class="abort" aria-label="abort">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                  >
                    <path d="M2 2l8 8M10 2L2 10" stroke="red" stroke-width="2" fill="none" />
                  </svg>
                </button>
              </form>
            ) : null}
          </td>
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
  readonly servers: ReadonlyArray<Server>;
  readonly process: ReadonlyArray<ProcessSeries>;
};

// Text an operator reads at a glance: the process graphs first, one card per named server, then
// two halves side by side — the automation queue and the qemu fleet with its add box — each
// swapped in fresh every thirty seconds. The style is the split and the combined graph. `halves`
// is absent only when the database could not be read, so a 500 page claims neither an empty
// queue nor an empty fleet; `error` is the reason a request was refused, on top.
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
          ".halves { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; } .abort { background: none; border: none; padding: 0; cursor: pointer; line-height: 0; vertical-align: middle; } .process-card { display: grid; gap: 0.5rem; margin: 0 0 1.5rem; } .process-card > h3, .process-card > p { margin: 0; } .process-graph { display: grid; gap: 0.35rem; } .process-graph__legend { margin: 0; } .process-graph__jobs { color: #222; } .process-graph__cpu { color: #06c; } .process-graph__memory { color: #666; } .process-graph__plot { position: relative; height: 8rem; border-bottom: 1px solid #888; } .process-graph__bars { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 1px; } .process-graph__bar { flex: 1 1 0; min-width: 0; min-height: 0; background: #ccc; } .process-graph__lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; } .process-graph__lines .process-graph__jobs, .process-graph__lines .process-graph__cpu { fill: none; stroke-width: 2; } .process-graph__lines .process-graph__jobs { stroke: #222; } .process-graph__lines .process-graph__cpu { stroke: #06c; }"
        }
      </style>
      <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
    </head>
    <body>
      <h1>oligarchy servers</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      <section>
        <h2>process</h2>
        {halves === undefined ? null : (
          <div id="process" hx-get="/servers/process" hx-trigger="every 30s">
            <Process series={halves.process} />
          </div>
        )}
      </section>
      <div class="halves">
        <section>
          <h2>automation</h2>
          {halves === undefined ? null : (
            <div id="queue" hx-get="/servers/queue" hx-trigger="every 30s">
              <Queue queue={halves.queue} />
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
