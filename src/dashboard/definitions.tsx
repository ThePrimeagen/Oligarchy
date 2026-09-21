import type { FC } from "hono/jsx";
import { OperatorPage } from "./page.tsx";
import {
  runningForDefinition,
  type AutomationJob,
  type DefinitionHistory,
  type DefinitionPill,
  type DefinitionRun,
  type DefinitionVersions,
} from "./query.ts";
import { since } from "./servers.tsx";
import { followHref, linearHref } from "./ticket.ts";

// A definition's name is its page: /definitions/lock-screen. The dashes are the name's own.
export const definitionHref = (name: string): string => `/definitions/${encodeURIComponent(name)}`;

const runningHref = (name: string | undefined): string =>
  name === undefined
    ? "/definitions/running"
    : `/definitions/running?name=${encodeURIComponent(name)}`;

// One running job, as a row of the same kind as the queue: the definition name stays this page's
// link, the ticket text goes to Linear, and how long it has been running opens the session feed.
// Abort is the queue's mark, posting the ticket and action the shared /abort route already stops.
// view=definitions is how that route tells this form apart from the servers page: htmx swaps the
// list, and a submit without it returns here. A job with no ticket has nothing to name.
const RunningJob: FC<{ job: AutomationJob; definition: string | undefined }> = ({
  job,
  definition,
}) => {
  const ticket = job.ticket;
  return (
    <tr>
      <td>
        <a href={definitionHref(job.test)}>{job.test}</a>
      </td>
      <td>{job.action}</td>
      <td>
        {ticket === null ? (
          "—"
        ) : (
          <a class="ticket" href={linearHref(ticket)}>
            {ticket}
          </a>
        )}
      </td>
      <td class={ticket === null ? undefined : "follow"}>
        {ticket === null ? (
          since(job.startedAt, job.queriedAt)
        ) : (
          <a href={followHref(ticket)}>{since(job.startedAt, job.queriedAt)}</a>
        )}
      </td>
      <td>
        {ticket === null ? null : (
          <form
            method="post"
            action="/abort"
            hx-post="/abort"
            hx-confirm="are you sure?"
            hx-target="#running-tests"
            hx-swap="innerHTML"
          >
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="action" value={job.action} />
            <input type="hidden" name="view" value="definitions" />
            {definition === undefined ? null : (
              <input type="hidden" name="definition" value={definition} />
            )}
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
        )}
      </td>
    </tr>
  );
};

// The list the page polls and the abort swaps in. Only what is running: a pending job has not
// started, and a finished one is a result, not something to stop. A table, like the queue.
export const RunningList: FC<{
  jobs: ReadonlyArray<AutomationJob>;
  definition: string | undefined;
}> = ({ jobs, definition }) =>
  jobs.length === 0 ? (
    <p class="running-tests__empty">No tests are running.</p>
  ) : (
    <table>
      <tr>
        <th>test</th>
        <th>action</th>
        <th>ticket</th>
        <th>running</th>
        <th></th>
      </tr>
      {jobs.map((job) => (
        <RunningJob job={job} definition={definition} />
      ))}
    </table>
  );

// On the index, above every definition, so an operator sees what is in flight before any wording.
// A definition's own page uses the same list only for that name, and only when one of its jobs
// is running. The poll is the queue's thirty seconds: a job that starts after the page opened
// shows up without a reload, and the swap replaces the list while the poll stays on this frame.
const RunningTests: FC<{
  jobs: ReadonlyArray<AutomationJob>;
  definition: string | undefined;
}> = ({ jobs, definition }) => (
  <section class="running-tests" aria-labelledby="running-tests-heading">
    <h2 id="running-tests-heading">Running</h2>
    <div
      id="running-tests"
      hx-get={runningHref(definition)}
      hx-trigger="every 30s"
      hx-swap="innerHTML"
    >
      <RunningList jobs={jobs} definition={definition} />
    </div>
  </section>
);

// Why the last edit of the selected definition was refused, when it was.
export type EditNotice = "unchanged" | "empty";

const EDIT_NOTICES: Record<EditNotice, string> = {
  unchanged: "Nothing changed: the newest wording already reads like this.",
  empty: "Every field needs text.",
};

// Same units a running job's age uses, without the "ago": how long a pass took.
const took = (ms: number): string => {
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

const shortResultId = (id: string): string => id.slice(0, 6);

// The dump of one result. The index pills still open /tests; a definition's page uses this.
export const testResultHref = (id: string): string => `/test-results/${encodeURIComponent(id)}`;

// The last ten verdicts, newest first. The short id is the link. A pass says how long it took.
// A fail says failed and the diagnosis it was given. Nothing here when the name has no verdict.
const DefinitionRuns: FC<{ runs: ReadonlyArray<DefinitionRun> }> = ({ runs }) =>
  runs.length === 0 ? null : (
    <ul class="definition-runs" aria-label="Last ten runs">
      {runs.map((run) => (
        <li>
          <a class={`definition-pill definition-pill--${run.status}`} href={testResultHref(run.id)}>
            {shortResultId(run.id)}
          </a>
          {run.status === "passed" && run.durationMs !== null ? (
            <span class="definition-pill__time">{took(run.durationMs)}</span>
          ) : null}
          {run.status === "failed" ? <span class="definition-pill__error">failed</span> : null}
          {run.status === "failed" && run.diagnosis !== null ? (
            <span class="definition-pill__diagnosis">{run.diagnosis}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );

const Definition: FC<{
  group: DefinitionVersions;
  notice: EditNotice | undefined;
  runs: ReadonlyArray<DefinitionRun>;
}> = ({ group, notice, runs }) => {
  const newest = group.versions[group.versions.length - 1];
  const next = group.versions.length + 1;
  // Two: the current wording and the one before it. Older wordings stay in the database.
  const shown = group.versions.slice(-2);
  return (
    <section>
      <h2>{group.name}</h2>
      <DefinitionRuns runs={runs} />
      {/* The class is what public/dashboard.js looks for: the button starts disabled and is
          enabled once a field differs from the wording it was rendered with. */}
      <form method="post" action="/definitions" class="definition__form">
        <input type="hidden" name="name" value={group.name} />
        <p>
          Updating writes v{next} of {group.name}; the earlier wordings keep their runs.
        </p>
        {notice === undefined ? null : <p role="alert">{EDIT_NOTICES[notice]}</p>}
        <label>
          description
          <textarea name="description" rows={3} required>
            {newest.description}
          </textarea>
        </label>
        <label>
          instruction
          <textarea name="instruction" rows={6} required>
            {newest.instruction}
          </textarea>
        </label>
        <label>
          proof
          <textarea name="proof" rows={3} required>
            {newest.proof}
          </textarea>
        </label>
        <button type="submit" disabled>
          Update
        </button>
      </form>
      {shown.toReversed().map((wording, index) => {
        const version = group.versions.length - index;
        return (
          <>
            <h3>v{version}</h3>
            <p class="wording">{wording.description}</p>
            <p class="wording">{wording.instruction}</p>
            <p class="wording">{wording.proof}</p>
          </>
        );
      })}
    </section>
  );
};

// Not a form: enter must not reload the page. public/dashboard.js matches and reorders the
// list as this is typed. autocomplete is off: a restored value does not fire input, so the
// list would not match the box.
const DefinitionSearch: FC = () => (
  <search class="search">
    <input type="search" aria-label="Search definitions" autocomplete="off" />
  </search>
);

const pillTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

// One result in the strip. The link is the diagnostic page. The tip is the hover: the name, the
// status, when it ran, and the model when one was recorded. A failure's reason is the red line.
const HistoryPill: FC<{ name: string; pill: DefinitionPill }> = ({ name, pill }) => {
  const at = new Date(pill.at);
  return (
    <a
      class={`definition-blip definition-blip--${pill.status}`}
      href={`/tests/${pill.id}`}
      aria-label={`${name} ${pill.status}`}
    >
      <span class="definition-tip" aria-hidden="true">
        <span class="definition-tip__name">{name}</span>
        <span class="definition-tip__status">{pill.status}</span>
        <time datetime={at.toISOString()}>{pillTime.format(at)}</time>
        {pill.model === null ? null : <span class="definition-tip__model">{pill.model}</span>}
        {pill.status === "failed" && pill.reason !== null ? (
          <span class="definition-tip__reason">{pill.reason}</span>
        ) : null}
      </span>
    </a>
  );
};

// The rate is passes out of that name's passes and fails. Running is a pill and not a count, so a
// name that has only ever been running has pills and no "0 out of 0". The wait is hidden until the
// minute refresh marks the block loading. Every name has a block, even with nothing in it yet, so
// that refresh has somewhere to put the first pill.
const DefinitionHistoryView: FC<{
  name: string;
  history: DefinitionHistory | undefined;
}> = ({ name, history }) => (
  <div class="definition-history" data-name={name}>
    {history !== undefined && history.total > 0 ? (
      <span class="definition-rate">
        {history.passed} out of {history.total}
      </span>
    ) : null}
    {history !== undefined && history.recent.length > 0 ? (
      <span class="definition-blips">
        {history.recent.map((item) => (
          <HistoryPill name={name} pill={item} />
        ))}
      </span>
    ) : null}
    <span class="definition-history__wait" aria-hidden="true">
      <span class="definition-history__spin"></span>
      {"Loading"}
    </span>
  </div>
);

// What /definitions/histories swaps in: one block per requested name, in that order, including a
// name that has nothing to draw so a strip can be cleared.
export const DefinitionHistories: FC<{
  names: ReadonlyArray<string>;
  histories: ReadonlyArray<DefinitionHistory>;
}> = ({ names, histories }) => {
  const byName = new Map(histories.map((history) => [history.name, history]));
  return (
    <>
      {names.map((name) => (
        <DefinitionHistoryView name={name} history={byName.get(name)} />
      ))}
    </>
  );
};

// Every name is on the page. Tests are rarely added, so the script matches and sorts them
// in the browser. The miss starts hidden; the script shows it when nothing matches.
// The pills are the last twenty-five passes, fails and runs, oldest on the left: green a pass,
// red a fail, yellow one that is still running. Pending is not drawn. public/dashboard.js rereads
// the ones on screen once a minute. The running list above is the part that polls by itself.
const DefinitionList: FC<{
  groups: ReadonlyArray<DefinitionVersions>;
  histories: ReadonlyArray<DefinitionHistory>;
}> = ({ groups, histories }) => {
  const byName = new Map(histories.map((history) => [history.name, history]));
  return groups.length === 0 ? (
    <p>no definitions</p>
  ) : (
    <>
      <ul class="definition-list">
        {groups.map((group) => (
          <li>
            <a href={definitionHref(group.name)}>{group.name}</a>
            <DefinitionHistoryView name={group.name} history={byName.get(group.name)} />
          </li>
        ))}
      </ul>
      <p class="definition-miss" hidden>
        No definitions match <code></code>.
      </p>
    </>
  );
};

// The index is a search and one link per name. A name's own page is its newest wording as a
// form, then the current wording and the one before it, and the last ten verdicts under the
// name. Running jobs sit above that body on the index. On a name's page they are that name's
// jobs, and the block is absent when none of them are running. `groups` is the index's list,
// absent on a name's page and when the database could not be read. `running` is absent on
// that same failure, so it does not claim that nothing is running. `error` is that failure;
// a name nobody carries is said on its own page.
export const DefinitionsPage: FC<{
  groups: ReadonlyArray<DefinitionVersions> | null;
  name: string | undefined;
  selected: DefinitionVersions | undefined;
  notice: EditNotice | undefined;
  error: string | undefined;
  running: ReadonlyArray<AutomationJob> | null;
  histories: ReadonlyArray<DefinitionHistory>;
  runs: ReadonlyArray<DefinitionRun>;
}> = ({ groups, name, selected, notice, error, running, histories, runs }) => {
  const index = error === undefined && name === undefined && groups !== null;
  // A name's page shows only that name's jobs. The index shows every one. A failed read
  // stays absent so the page does not claim that nothing is running.
  let shownRunning: ReadonlyArray<AutomationJob> | null;
  if (running === null) shownRunning = null;
  else if (name === undefined) shownRunning = running;
  else shownRunning = runningForDefinition(running, name);
  return (
    <OperatorPage title="oligarchy definitions" page="definitions" scriptSrc="/dashboard.js">
      <h1>oligarchy definitions</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      {index ? <DefinitionSearch /> : null}
      {shownRunning === null || (name !== undefined && shownRunning.length === 0) ? null : (
        <RunningTests jobs={shownRunning} definition={name} />
      )}
      {index ? <DefinitionList groups={groups} histories={histories} /> : null}
      {error === undefined && name !== undefined && selected === undefined ? (
        <p>
          No test definition named <code>{name}</code>.
        </p>
      ) : null}
      {selected === undefined ? null : <Definition group={selected} notice={notice} runs={runs} />}
    </OperatorPage>
  );
};
