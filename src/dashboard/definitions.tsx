import type { FC } from "hono/jsx";
import { OperatorPage } from "./page.tsx";
import type { AutomationJob, DefinitionVersions } from "./query.ts";
import { since } from "./servers.tsx";

const definitionHref = (name: string): string => `/definitions?name=${encodeURIComponent(name)}`;

const runningHref = (name: string | undefined): string =>
  name === undefined
    ? "/definitions/running"
    : `/definitions/running?name=${encodeURIComponent(name)}`;

// One running job: its definition, what it is doing, the ticket that names it, and how long it
// has been running. Abort posts the ticket and action the shared /abort route already stops.
// view=definitions is how that route tells this form apart from the servers page: htmx swaps
// the list, and a submit without it returns here. A job with no ticket has nothing to name.
const RunningJob: FC<{ job: AutomationJob; definition: string | undefined }> = ({
  job,
  definition,
}) => (
  <li class="running-tests__job">
    <a href={definitionHref(job.test)}>{job.test}</a>
    <span class="running-tests__action">{job.action}</span>
    <span class="running-tests__ticket">{job.ticket ?? "—"}</span>
    <span class="running-tests__age">{since(job.startedAt, job.queriedAt)}</span>
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
        <button type="submit" class="button button--abort">
          Abort
        </button>
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
    <p class="running-tests__empty">No tests are running.</p>
  ) : (
    <ol class="running-tests__list">
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
            <p class="wording">{wording.description}</p>
            <p class="wording">{wording.instruction}</p>
            <p class="wording">{wording.proof}</p>
          </>
        );
      })}
    </section>
  );
};

// Text, like the servers page: each name, its newest wording as a form, then the current
// wording and the one before it as paragraphs. Running jobs sit above that. `groups` and
// `running` are absent only when the database could not be read, so a failure does not claim
// that nothing is running. `error` is that failure; a name nobody carries is said on its own.
export const DefinitionsPage: FC<{
  groups: ReadonlyArray<DefinitionVersions> | null;
  name: string | undefined;
  selected: DefinitionVersions | undefined;
  notice: EditNotice | undefined;
  error: string | undefined;
  running: ReadonlyArray<AutomationJob> | null;
}> = ({ groups, name, selected, notice, error, running }) => {
  let body = null;
  if (groups !== null && groups.length === 0) {
    body = <p>no definitions</p>;
  } else if (groups !== null) {
    body = groups.map((group) => (
      <Definition group={group} notice={group.name === selected?.name ? notice : undefined} />
    ));
  }
  return (
    <OperatorPage title="oligarchy definitions" page="definitions" scriptSrc="/dashboard.js">
      <h1>oligarchy definitions</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      {name !== undefined && groups !== null && selected === undefined ? (
        <p>
          No test definition named <code>{name}</code>.
        </p>
      ) : null}
      {running === null ? null : (
        <RunningTests jobs={running} definition={name ?? selected?.name} />
      )}
      {body}
    </OperatorPage>
  );
};
