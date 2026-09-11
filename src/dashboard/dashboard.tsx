import * as Sentry from "@sentry/cloudflare";
import { type Context, Hono } from "hono";
import { html } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import {
  abortAutomationJob,
  addServer,
  definitionStats,
  getImage,
  groupDefinitions,
  listAutomationQueue,
  listServers,
  listSessions,
  listTestBasePrompts,
  listTestDefinitions,
  listTestResultOutcomes,
  modelStats,
  removeServer,
  reviseTestDefinition,
  selectDefinition,
  versionStats,
  type DefinitionStat,
  type DefinitionVersions,
  type Session,
  type TestBasePrompt,
  type TestResultOutcome,
} from "./query.ts";
import { clickerPage } from "./clicker.ts";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";
import { Fleet, type Halves, Queue, ServersPage } from "./servers.tsx";
import { SENTRY_DSN } from "../observability/dsn.ts";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

type Bindings = {
  HYPERDRIVE: {
    connectionString: string;
  };
  // wrangler secret; the same token POST /abort on the automation server checks.
  OLIGARCHY_TOKEN: string;
  // The automation server's base url, set as a Cloudflare var.
  AUTOMATION_SERVER_URL: string;
};

type SessionListProps = {
  sessions: Session[];
};

type SessionStatusProps = {
  sessions: Session[] | null;
  outOfBand?: boolean;
};

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const SessionStatus: FC<SessionStatusProps> = ({ sessions, outOfBand = false }) => (
  <span id="session-status" hx-swap-oob={outOfBand ? "innerHTML" : undefined}>
    {sessions === null ? (
      "Sessions unavailable"
    ) : sessions.length === 0 ? (
      "No sessions recorded"
    ) : (
      <>
        Updated{" "}
        <time dateTime={sessions[0].queriedAt.toISOString()}>
          {dateTime.format(sessions[0].queriedAt)}
        </time>
      </>
    )}
  </span>
);

type ChartRow = {
  readonly label: string;
  readonly succeeded: number;
  readonly failed: number;
};

// One stacked bar per row: succeeded then failed, each as wide as its share.
const ResultChart: FC<{ title: string; rows: ReadonlyArray<ChartRow> }> = ({ title, rows }) => (
  <div class="record__field">
    <h3>{title}</h3>
    {rows.length === 0 ? (
      <p class="result-chart__empty">No passed or failed results yet.</p>
    ) : (
      <ul class="result-chart">
        {rows.map((row) => (
          <li class="result-chart__row">
            <span class="result-chart__name">{row.label}</span>
            <div
              class="result-chart__bar"
              role="img"
              aria-label={`${row.label}: ${String(row.succeeded)} succeeded, ${String(row.failed)} failed`}
            >
              {row.succeeded > 0 ? (
                <span class="result-chart__ok" style={{ flexGrow: row.succeeded, flexBasis: 0 }}>
                  {row.succeeded}
                </span>
              ) : null}
              {row.failed > 0 ? (
                <span class="result-chart__failed" style={{ flexGrow: row.failed, flexBasis: 0 }}>
                  {row.failed}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const DefinitionScoreboard: FC<{ stats: ReadonlyArray<DefinitionStat> }> = ({ stats }) =>
  stats.length === 0 ? null : (
    <table class="scoreboard">
      <caption>Last 50 sessions by test definition</caption>
      <thead>
        <tr>
          <th>Test</th>
          <th>Succeeded</th>
          <th>Failed</th>
          <th>Other</th>
          <th>Model</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((row) => (
          <tr>
            <th>{row.name}</th>
            <td class="scoreboard__ok">{row.succeeded}</td>
            <td class="scoreboard__failed">{row.failed}</td>
            <td>{row.other}</td>
            <td>{row.models.length === 0 ? "—" : row.models.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

const SessionList: FC<SessionListProps> = ({ sessions }) =>
  sessions.length === 0 ? (
    <div class="empty-state">
      <p>No sessions recorded yet.</p>
    </div>
  ) : (
    <>
      <DefinitionScoreboard stats={definitionStats(sessions)} />
      <ol>
        {sessions.map((session) => {
          const isoName = session.config.iso.split("/").at(-1) ?? session.config.iso;
          const isRemoteIso =
            session.config.iso.startsWith("https://") || session.config.iso.startsWith("http://");
          return (
            <li>
              <article class="session">
                <figure class="session__visual">
                  {session.imageId === null ? (
                    <div
                      class="session__placeholder"
                      role="img"
                      aria-label="No screenshot captured"
                    ></div>
                  ) : (
                    <img
                      class="session__image"
                      src={`/images/${session.imageId}`}
                      alt={`Last captured frame from session ${session.id}`}
                      loading="lazy"
                    />
                  )}
                  <span
                    class={`status status--${session.status}${session.imageId === null ? " status--centered" : ""}`}
                  >
                    {session.status === "timed_out" ? "timed out" : session.status}
                  </span>
                </figure>
                <div class="session__details">
                  {session.definitionName === null ? null : (
                    <div class="session__version">
                      <span>Test</span>
                      <span class="session__version-name">
                        {session.definitionName} v{session.definitionVersion}
                      </span>
                    </div>
                  )}
                  {session.model === null ? null : (
                    <div class="session__version">
                      <span>Model</span>
                      <span class="session__version-name">{session.model}</span>
                    </div>
                  )}
                  <div class="session__version">
                    <span>Omarchy version</span>
                    {isRemoteIso ? (
                      <a href={session.config.iso}>{isoName}</a>
                    ) : (
                      <span class="session__version-name">{isoName}</span>
                    )}
                  </div>
                  <code title={session.id}>{session.id}</code>
                  {session.status === "failed" && session.reason !== null ? (
                    <p class="session__reason">
                      <strong>Last failure</strong>
                      {session.reason}
                    </p>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </>
  );

const SessionError: FC = () => (
  <div class="empty-state empty-state--error">
    <p>Sessions are unavailable.</p>
    <span>Try refreshing in a moment.</span>
  </div>
);

type PageId = "results" | "definitions" | "prompts";

const PAGES = [
  { id: "results", href: "/", label: "Test results" },
  { id: "definitions", href: "/definitions", label: "Test definitions" },
  { id: "prompts", href: "/prompts", label: "Base prompts" },
] as const;

const Menu: FC<{ page: PageId }> = ({ page }) => (
  <details class="menu">
    <summary class="menu__toggle" aria-label="Menu">
      <span class="menu__icon" aria-hidden="true"></span>
    </summary>
    <nav class="menu__nav" aria-label="Pages">
      {PAGES.map((item) => (
        <a
          href={item.href}
          class={item.id === page ? "menu__link menu__link--current" : "menu__link"}
          aria-current={item.id === page ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  </details>
);

const Shell: FC<PropsWithChildren<{ page: PageId }>> = ({ page, children }) => (
  <main data-page={page}>
    <Menu page={page} />
    <header class="hero">
      <div class="brand" aria-label="Omarchy">
        OMARCHY
      </div>
    </header>
    {children}
  </main>
);

type HomeProps = {
  sessions: Session[] | null;
};

const Home: FC<HomeProps> = ({ sessions }) => (
  <Shell page="results">
    <section class="sessions" aria-labelledby="sessions-heading">
      <div class="sessions__heading">
        <div>
          <h1 id="sessions-heading">Test results</h1>
        </div>
        <button
          class="button"
          type="button"
          hx-get="/sessions"
          hx-target="#session-list"
          hx-swap="innerHTML"
        >
          Refresh
        </button>
      </div>
      <p class="session-list__updated" aria-live="polite">
        <SessionStatus sessions={sessions} />
      </p>
      <div id="session-list" class="session-list">
        {sessions === null ? <SessionError /> : <SessionList sessions={sessions} />}
      </div>
    </section>
  </Shell>
);

type EditNotice = "unchanged" | "empty";

const EDIT_NOTICES: Record<EditNotice, string> = {
  unchanged: "Nothing changed: the newest wording already reads like this.",
  empty: "Every field needs text.",
};

type DefinitionsProps = {
  groups: DefinitionVersions[] | null;
  outcomes: TestResultOutcome[];
  // The ?name the page was asked for and the definition it resolved to: nothing when the name is
  // unknown, so the wide layout can say so instead of opening on another one.
  name: string | undefined;
  selected: DefinitionVersions | undefined;
  // Why the last edit of the selected definition was refused, when it was.
  notice: EditNotice | undefined;
};

const definitionHref = (name: string): string => `/definitions?name=${encodeURIComponent(name)}`;
const editHref = (name: string, notice: EditNotice): string =>
  `${definitionHref(name)}&edit=${notice}`;

const RunsTable: FC<{ runs: ReadonlyArray<TestResultOutcome> }> = ({ runs }) =>
  runs.length === 0 ? (
    <p class="result-chart__empty">No runs yet.</p>
  ) : (
    <table class="runs">
      <thead>
        <tr>
          <th>Run</th>
          <th>Omarchy version</th>
          <th>Started</th>
          <th>Model</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr>
            <td>
              <code>{run.runId}</code>
            </td>
            <td>{run.iso.split("/").at(-1) ?? run.iso}</td>
            <td>
              <time dateTime={run.startedAt.toISOString()}>{dateTime.format(run.startedAt)}</time>
            </td>
            <td>{run.model ?? "—"}</td>
            <td>{run.status === "timed_out" ? "timed out" : run.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

// One name's card: its results by version beside the newest wording as a form whose update writes
// the next version, then every wording newest first, the newest open, each with its text, its
// results by model and the runs that used it. The name is what the wordings collapse under, so it
// is not a field.
const DefinitionCard: FC<{
  group: DefinitionVersions;
  outcomes: ReadonlyArray<TestResultOutcome>;
  notice: EditNotice | undefined;
}> = ({ group, outcomes, notice }) => {
  const newest = group.versions[group.versions.length - 1];
  const next = group.versions.length + 1;
  return (
    <article class="record definition">
      <h2>{group.name}</h2>
      <div class="definition__chart">
        <ResultChart
          title="Results by version"
          rows={versionStats(group.versions, outcomes).map((row) => ({
            label: `v${String(row.version)}`,
            succeeded: row.succeeded,
            failed: row.failed,
          }))}
        />
      </div>
      {/* The update button is handed over disabled; public/dashboard.js enables it once a field
          differs from the wording it was rendered with, so an unchanged wording is not offered. */}
      <form method="post" action="/definitions" class="definition__form">
        <input type="hidden" name="name" value={group.name} />
        <p class="definition__form-note">
          Updating writes v{next} of {group.name}; the earlier wordings keep their runs.
        </p>
        {notice === undefined ? null : (
          <p class="definition__form-notice" role="alert">
            {EDIT_NOTICES[notice]}
          </p>
        )}
        <label class="definition__form-field">
          <span>Description</span>
          <textarea name="description" rows={3} required>
            {newest.description}
          </textarea>
        </label>
        <label class="definition__form-field">
          <span>Instruction</span>
          <textarea name="instruction" rows={6} required>
            {newest.instruction}
          </textarea>
        </label>
        <label class="definition__form-field">
          <span>Proof</span>
          <textarea name="proof" rows={3} required>
            {newest.proof}
          </textarea>
        </label>
        <button class="button" type="submit" disabled>
          Update
        </button>
      </form>
      <ul class="definition__wordings">
        {group.versions.toReversed().map((wording, index) => {
          const version = group.versions.length - index;
          const runs = outcomes
            .filter((row) => row.definitionId === wording.id)
            .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
          return (
            <li>
              <details class="definition__wording" open={version === group.versions.length}>
                <summary>
                  <span class="definition__wording-label">v{version}</span>
                  <time dateTime={wording.createdAt.toISOString()}>
                    {dateTime.format(wording.createdAt)}
                  </time>
                  <span class="definition__wording-runs">
                    {runs.length} {runs.length === 1 ? "run" : "runs"}
                  </span>
                </summary>
                <div class="definition__wording-body">
                  <div class="definition__fields">
                    <div class="record__field">
                      <h3>Description</h3>
                      <p>{wording.description}</p>
                    </div>
                    <div class="record__field">
                      <h3>Instruction</h3>
                      <p>{wording.instruction}</p>
                    </div>
                    <div class="record__field">
                      <h3>Proof</h3>
                      <p>{wording.proof}</p>
                    </div>
                  </div>
                  <div class="definition__chart">
                    <ResultChart
                      title="Results by model"
                      rows={modelStats(runs).map((row) => ({
                        label: row.model,
                        succeeded: row.succeeded,
                        failed: row.failed,
                      }))}
                    />
                  </div>
                  <div class="record__field definition__runs">
                    <h3>Runs</h3>
                    <RunsTable runs={runs} />
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </article>
  );
};

// Every card is in the page so a narrow screen keeps its scrolling list; the wide layout shows
// the sidebar and only the current card. A sidebar click fetches the page for that name and swaps
// this section in place (htmx 4 inherits an attribute only when told to), pushing the URL so a
// reload or a shared link opens on the same definition.
const Definitions: FC<DefinitionsProps> = ({ groups, outcomes, name, selected, notice }) => (
  <Shell page="definitions">
    <section id="definitions" class="records definitions" aria-labelledby="definitions-heading">
      <div class="sessions__heading">
        <h1 id="definitions-heading">Test definitions</h1>
      </div>
      {groups === null ? (
        <div class="empty-state empty-state--error">
          <p>Test definitions are unavailable.</p>
          <span>Try refreshing in a moment.</span>
        </div>
      ) : groups.length === 0 ? (
        <div class="empty-state">
          <p>No test definitions yet.</p>
        </div>
      ) : (
        <div class="definitions__layout">
          <nav
            class="definitions__nav"
            aria-label="Test definitions"
            hx-target:inherited="#definitions"
            hx-select:inherited="#definitions"
            hx-swap:inherited="outerHTML"
            hx-push-url:inherited="true"
          >
            {groups.map((group) => {
              const isCurrent = group.name === selected?.name;
              // The swap replaces the focused link; htmx puts focus back only on an element with
              // the same id, so a keyboard user does not fall back to the top of the page. The
              // first wording's id is the name's for good.
              return (
                <a
                  id={`definition-${String(group.versions[0].id)}`}
                  href={definitionHref(group.name)}
                  hx-get={definitionHref(group.name)}
                  class={
                    isCurrent ? "definitions__link definitions__link--current" : "definitions__link"
                  }
                  aria-current={isCurrent ? "true" : undefined}
                >
                  {group.name}
                </a>
              );
            })}
          </nav>
          <div class="definitions__detail">
            {selected === undefined ? (
              <div class="empty-state definitions__missing">
                <p>
                  No test definition named <code>{name}</code>.
                </p>
                <span>Pick one from the list.</span>
              </div>
            ) : null}
            <ol class="definitions__list">
              {groups.map((group) => (
                <li
                  class={
                    group.name === selected?.name
                      ? "definitions__item definitions__item--current"
                      : "definitions__item"
                  }
                >
                  <DefinitionCard
                    group={group}
                    outcomes={outcomes}
                    notice={group.name === selected?.name ? notice : undefined}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  </Shell>
);

type PromptsProps = {
  prompts: TestBasePrompt[] | null;
};

const Prompts: FC<PromptsProps> = ({ prompts }) => (
  <Shell page="prompts">
    <section class="records" aria-labelledby="prompts-heading">
      <div class="sessions__heading">
        <h1 id="prompts-heading">Base prompts</h1>
      </div>
      <div class="record-list">
        {prompts === null ? (
          <div class="empty-state empty-state--error">
            <p>Base prompts are unavailable.</p>
            <span>Try refreshing in a moment.</span>
          </div>
        ) : prompts.length === 0 ? (
          <div class="empty-state">
            <p>No base prompts yet.</p>
          </div>
        ) : (
          <ol>
            {prompts.map((prompt) => (
              <li>
                <article class="record">
                  <h2>{prompt.name}</h2>
                  <time dateTime={prompt.createdAt.toISOString()}>
                    {dateTime.format(prompt.createdAt)}
                  </time>
                  <div class="record__field">
                    <h3>Prompt</h3>
                    <p>{prompt.prompt}</p>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  </Shell>
);

export const app = new Hono<{ Bindings: Bindings }>();

app.use(async (context, next) => {
  if (new URL(context.req.url).hostname === "clicker.oligarchy.trm.sh") {
    return context.html(clickerPage);
  }
  return next();
});

app.use(
  jsxRenderer(({ children }) => (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1a1b26" />
        <title>Omarchy</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/dashboard.css" />
        <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
        <script src="/dashboard.js" defer></script>
      </head>
      <body>{children}</body>
    </html>
  )),
);

app.get("/", async (context) => {
  try {
    const sessions = await listSessions(context.env.HYPERDRIVE.connectionString);
    return context.render(<Home sessions={sessions} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing sessions:", errorMessage(error));
    context.status(500);
    return context.render(<Home sessions={null} />);
  }
});

app.get("/definitions", async (context) => {
  const name = context.req.query("name");
  const edit = context.req.query("edit");
  // Only the two refusals the edit route redirects with are a notice; anything else in ?edit is
  // a stale or hand-made link and shows nothing.
  const notice = edit === "unchanged" || edit === "empty" ? edit : undefined;
  try {
    const [definitions, outcomes] = await Promise.all([
      listTestDefinitions(context.env.HYPERDRIVE.connectionString),
      listTestResultOutcomes(context.env.HYPERDRIVE.connectionString),
    ]);
    const groups = groupDefinitions(definitions);
    const selected = selectDefinition(groups, name);
    // A stale link: the page still lists what exists, the status says the name does not.
    if (name !== undefined && selected === undefined) {
      context.status(404);
    }
    return context.render(
      <Definitions
        groups={groups}
        outcomes={outcomes}
        name={name}
        selected={selected}
        notice={notice}
      />,
    );
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading the definitions page:", errorMessage(error));
    context.status(500);
    return context.render(
      <Definitions
        groups={null}
        outcomes={[]}
        name={name}
        selected={undefined}
        notice={undefined}
      />,
    );
  }
});

// The edit form's save: the next wording of a known name. The browser's `required` keeps the
// fields filled; a request that arrives without one is answered all the same.
app.post("/definitions", async (context) => {
  const body = await context.req.parseBody();
  // A field is text with something in it; a file part is not this form's. A browser submits a
  // textarea's newlines as CRLF; the wording is kept with LF, as ctrl writes it, so the same text
  // posted back reads unchanged.
  const text = (value: (typeof body)[string]): string | undefined =>
    typeof value === "string" && value !== "" ? value.replaceAll("\r\n", "\n") : undefined;
  const name = text(body.name);
  if (name === undefined) {
    return context.notFound();
  }
  const description = text(body.description);
  const instruction = text(body.instruction);
  const proof = text(body.proof);
  if (description === undefined || instruction === undefined || proof === undefined) {
    return context.redirect(editHref(name, "empty"), 303);
  }
  try {
    const revision = await reviseTestDefinition(context.env.HYPERDRIVE.connectionString, {
      name,
      description,
      instruction,
      proof,
    });
    switch (revision) {
      case "unknown":
        return context.notFound();
      case "unchanged":
        return context.redirect(editHref(name, "unchanged"), 303);
      case "revised":
        return context.redirect(definitionHref(name), 303);
    }
    return revision satisfies never;
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: saving a definition:", errorMessage(error));
    context.status(500);
    return context.render(
      <Definitions
        groups={null}
        outcomes={[]}
        name={name}
        selected={undefined}
        notice={undefined}
      />,
    );
  }
});

app.get("/prompts", async (context) => {
  try {
    const prompts = await listTestBasePrompts(context.env.HYPERDRIVE.connectionString);
    return context.render(<Prompts prompts={prompts} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing base prompts:", errorMessage(error));
    context.status(500);
    return context.render(<Prompts prompts={null} />);
  }
});

app.get("/sessions", async (context) => {
  try {
    const sessions = await listSessions(context.env.HYPERDRIVE.connectionString);
    return context.html(
      <>
        <SessionStatus sessions={sessions} outOfBand />
        <SessionList sessions={sessions} />
      </>,
    );
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing sessions:", errorMessage(error));
    return context.html(
      <>
        <SessionStatus sessions={null} outOfBand />
        <SessionError />
      </>,
      500,
    );
  }
});

app.get("/images/:id", async (context) => {
  const id = context.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return context.notFound();
  }

  try {
    const image = await getImage(context.env.HYPERDRIVE.connectionString, id);
    if (image === undefined) {
      return context.notFound();
    }
    return new Response(new Uint8Array(image), {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/png",
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading image:", errorMessage(error));
    return context.body(null, 500);
  }
});

// The servers page, outside the dashboard's shell: text served whole, not through the renderer.
// Its two halves are rows: the automation queue the webhook and the worker write
// (automation_jobs), and the fleet the servers themselves write every thirty seconds
// (src/qemu-server/heartbeat.ts), both read here as often. `halves` is absent only when the database
// could not be read, so a 500 page claims neither an empty queue nor an empty fleet.
const readHalves = async (connectionString: string): Promise<Halves> => {
  const [queue, servers] = await Promise.all([
    listAutomationQueue(connectionString),
    listServers(connectionString),
  ]);
  return { queue, servers };
};

const serversPage = (
  context: Context<{ Bindings: Bindings }>,
  status: 200 | 400 | 404 | 500,
  halves: Halves | undefined,
  error?: string,
) => context.html(html`<!doctype html>${<ServersPage halves={halves} error={error} />}`, status);

const SERVER_URL_RULE = "url must be an http or https url";

// Domain.ServerUrl's rule, without Effect in the Worker: http or https with a host, kept as given.
const isServerUrl = (url: string): boolean => {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "";
};

app.get("/servers", async (context) => {
  try {
    const halves = await readHalves(context.env.HYPERDRIVE.connectionString);
    return await serversPage(context, 200, halves);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: reading the servers page:", errorMessage(error));
    return serversPage(context, 500, undefined, "internal error");
  }
});

// What the automation half's poll swaps in.
app.get("/servers/queue", async (context) => {
  try {
    const queue = await listAutomationQueue(context.env.HYPERDRIVE.connectionString);
    return context.html(<Queue queue={queue} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing the automation queue:", errorMessage(error));
    return context.html(<p>error: internal error</p>, 500);
  }
});

// What the fleet half's poll swaps in.
app.get("/servers/fleet", async (context) => {
  try {
    const servers = await listServers(context.env.HYPERDRIVE.connectionString);
    return context.html(<Fleet servers={servers} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing servers:", errorMessage(error));
    return context.html(<p>error: internal error</p>, 500);
  }
});

// The add box. Nothing is probed: the server says whether it is there by announcing itself into
// the row. A refusal renders the page again with the reason on top, so the operator can act on
// it where they are.
app.post("/servers", async (context) => {
  const { url } = await context.req.parseBody();
  const connectionString = context.env.HYPERDRIVE.connectionString;
  try {
    if (typeof url !== "string" || !isServerUrl(url)) {
      return await serversPage(context, 400, await readHalves(connectionString), SERVER_URL_RULE);
    }
    await addServer(connectionString, url);
    return context.redirect("/servers", 303);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: adding a server:", errorMessage(error));
    return serversPage(context, 500, undefined, "internal error");
  }
});

// A row's delete button. Forgetting a server leaves the sessions routed to it routable; a server
// still running announces itself back within thirty seconds.
app.post("/servers/delete", async (context) => {
  const { url } = await context.req.parseBody();
  const connectionString = context.env.HYPERDRIVE.connectionString;
  try {
    if (typeof url !== "string" || !isServerUrl(url)) {
      return await serversPage(context, 400, await readHalves(connectionString), SERVER_URL_RULE);
    }
    if (!(await removeServer(connectionString, url))) {
      return await serversPage(
        context,
        404,
        await readHalves(connectionString),
        `${url} is not registered`,
      );
    }
    return context.redirect("/servers", 303);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: removing a server:", errorMessage(error));
    return serversPage(context, 500, undefined, "internal error");
  }
});

// POST /abort asks the automation server to stop the running job for a ticket. A 200 from
// that server is the close. A 4xx or 5xx, or no answer at all, closes a running row here
// so the queue does not stay stuck; Sentry records "Cloudflare aborted job" only when
// that write lands. This route always answers 200: the operator's click is done either way.
app.post("/abort", async (context) => {
  try {
    const body: unknown = await context.req.json();
    const ticket =
      typeof body === "object" &&
      body !== null &&
      "ticket" in body &&
      typeof body.ticket === "string" &&
      body.ticket !== ""
        ? body.ticket
        : undefined;
    if (ticket === undefined) {
      return context.json({ ok: "true" });
    }
    try {
      const response = await fetch(new URL("/abort", context.env.AUTOMATION_SERVER_URL), {
        method: "POST",
        headers: {
          authorization: `Bearer ${context.env.OLIGARCHY_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticket }),
      });
      if (response.status === 200) {
        return context.json({ ok: "true" });
      }
      console.error(
        `dashboard: aborting a job: automation server returned ${String(response.status)}`,
      );
    } catch (error) {
      console.error("dashboard: aborting a job:", errorMessage(error));
    }
    try {
      if (await abortAutomationJob(context.env.HYPERDRIVE.connectionString, ticket)) {
        Sentry.captureException(new Error("Cloudflare aborted job"));
      }
    } catch (error) {
      Sentry.captureException(error);
      console.error("dashboard: aborting a job:", errorMessage(error));
    }
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: aborting a job:", errorMessage(error));
  }
  return context.json({ ok: "true" });
});

export default Sentry.withSentry(
  () => ({
    dsn: SENTRY_DSN,
    dataCollection: {},
  }),
  app,
);
