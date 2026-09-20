import type { FC } from "hono/jsx";
import { OperatorPage } from "./page.tsx";
import type { AutomationJob, DefinitionVersions } from "./query.ts";
import { since } from "./servers.tsx";
import { followHref, linearHref } from "./ticket.ts";

// A definition's name is its page: /definitions/lock-screen. The dashes are the name's own.
export const definitionHref = (name: string): string => `/definitions/${encodeURIComponent(name)}`;

const runningHref = (name: string | undefined): string =>
  name === undefined
    ? "/definitions/running"
    : `/definitions/running?name=${encodeURIComponent(name)}`;

// One running job: its definition, what it is doing, the ticket that names it, and how long it
// has been running. The definition name stays this page's link. The ticket text goes to Linear.
// follow opens the session feed. Abort posts the ticket and action the shared /abort route
// already stops. view=definitions is how that route tells this form apart from the servers page:
// htmx swaps the list, and a submit without it returns here. A job with no ticket has nothing to
// name.
const RunningJob: FC<{ job: AutomationJob; definition: string | undefined }> = ({
  job,
  definition,
}) => (
  <li>
    <a href={definitionHref(job.test)}>{job.test}</a>
    <span>{job.action}</span>
    {job.ticket === null ? <span>—</span> : <a href={linearHref(job.ticket)}>{job.ticket}</a>}
    <span>{since(job.startedAt, job.queriedAt)}</span>
    {job.ticket === null ? null : <a href={followHref(job.ticket)}>follow</a>}
    {job.ticket === null ? null : (
      <form
        method="post"
        action="/abort"
        hx-post="/abort"
        hx-confirm="are you sure?"
        hx-target="#running-tests"
        hx-swap="innerHTML"
      >
        <input type="hidden" name="ticket" value={job.ticket} />
        <input type="hidden" name="action" value={job.action} />
        <input type="hidden" name="view" value="definitions" />
        {definition === undefined ? null : (
          <input type="hidden" name="definition" value={definition} />
        )}
        <button type="submit">abort</button>
      </form>
    )}
  </li>
);

// The list the page polls and the abort swaps in. Only what is running: a pending job has not
// started, and a finished one is a result, not something to stop.
export const RunningList: FC<{
  jobs: ReadonlyArray<AutomationJob>;
  definition: string | undefined;
}> = ({ jobs, definition }) =>
  jobs.length === 0 ? (
    <p>No tests are running.</p>
  ) : (
    <ol>
      {jobs.map((job) => (
        <RunningJob job={job} definition={definition} />
      ))}
    </ol>
  );

// Above every definition, so an operator sees what is in flight before any wording. The poll is
// the queue's thirty seconds: a job that starts after the page opened shows up without a reload,
// and the swap replaces the list while the poll stays on this frame.
const RunningTests: FC<{
  jobs: ReadonlyArray<AutomationJob>;
  definition: string | undefined;
}> = ({ jobs, definition }) => (
  <section aria-labelledby="running-tests-heading">
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

const Definition: FC<{
  group: DefinitionVersions;
  notice: EditNotice | undefined;
}> = ({ group, notice }) => {
  const newest = group.versions[group.versions.length - 1];
  const next = group.versions.length + 1;
  // Two: the current wording and the one before it. Older wordings stay in the database.
  const shown = group.versions.slice(-2);
  return (
    <section>
      <h2>{group.name}</h2>
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
            <pre>{wording.description}</pre>
            <pre>{wording.instruction}</pre>
            <pre>{wording.proof}</pre>
          </>
        );
      })}
    </section>
  );
};

// Not a form: enter must not reload the page. public/dashboard.js narrows the list as this is typed.
// autocomplete is off: a restored value does not fire input, so the list would not match the box.
const DefinitionSearch: FC = () => (
  <search>
    <input type="search" aria-label="Search definitions" autocomplete="off" />
  </search>
);

// Every name is on the page. Definitions do not change while it is open, so the search hides
// rows in the browser. The miss starts hidden; the script shows it when nothing matches.
const DefinitionList: FC<{ groups: ReadonlyArray<DefinitionVersions> }> = ({ groups }) =>
  groups.length === 0 ? (
    <p>no definitions</p>
  ) : (
    <>
      <ul class="definition-list">
        {groups.map((group) => (
          <li>
            <a href={definitionHref(group.name)}>{group.name}</a>
          </li>
        ))}
      </ul>
      <p class="definition-miss" hidden>
        No definitions match <code></code>.
      </p>
    </>
  );

// The index is a search and one link per name. A name's own page is its newest wording as a
// form, then the current wording and the one before it. Running jobs sit above that body.
// `groups` is the index's list, absent on a name's page and when the database could not be
// read. `running` is absent on that same failure, so it does not claim that nothing is running.
// `error` is that failure; a name nobody carries is said on its own page.
export const DefinitionsPage: FC<{
  groups: ReadonlyArray<DefinitionVersions> | null;
  name: string | undefined;
  selected: DefinitionVersions | undefined;
  notice: EditNotice | undefined;
  error: string | undefined;
  running: ReadonlyArray<AutomationJob> | null;
}> = ({ groups, name, selected, notice, error, running }) => {
  const index = error === undefined && name === undefined && groups !== null;
  return (
    <OperatorPage title="oligarchy definitions" page="definitions" scriptSrc="/dashboard.js">
      <h1>oligarchy definitions</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      {index ? <DefinitionSearch /> : null}
      {running === null ? null : <RunningTests jobs={running} definition={name} />}
      {index ? <DefinitionList groups={groups} /> : null}
      {error === undefined && name !== undefined && selected === undefined ? (
        <p>
          No test definition named <code>{name}</code>.
        </p>
      ) : null}
      {selected === undefined ? null : <Definition group={selected} notice={notice} />}
    </OperatorPage>
  );
};
