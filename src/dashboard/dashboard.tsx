import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import {
  definitionStats,
  getImage,
  groupDefinitions,
  listSessions,
  listTestBasePrompts,
  listTestDefinitions,
  listTestResultOutcomes,
  modelStats,
  selectDefinition,
  versionStats,
  type DefinitionStat,
  type DefinitionVersions,
  type Session,
  type TestBasePrompt,
  type TestDefinition,
  type TestResultOutcome,
} from "./query.ts";
import { clickerPage } from "./clicker.ts";
import { SENTRY_DSN } from "../observability/dsn.ts";

const HTMX_URL = "https://cdn.jsdelivr.net/npm/htmx.org@4.0.0";
const HTMX_INTEGRITY = "sha384-BvJpBiO8Kh31EqtJe5DRIeWrHWnCGkwytKs9NKFi86Hhw96dEqdEMzZDeK9iEGTc";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

type Bindings = {
  HYPERDRIVE: {
    connectionString: string;
  };
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

type DefinitionsProps = {
  groups: DefinitionVersions[] | null;
  outcomes: TestResultOutcome[];
  // The ?name and ?id the page was asked for, and the wording they resolved to: nothing when the
  // name is unknown or the id is not one of its wordings, so the wide layout can say so instead
  // of opening on another one.
  name: string | undefined;
  id: string | undefined;
  selected: TestDefinition | undefined;
};

const definitionHref = (name: string): string => `/definitions?name=${encodeURIComponent(name)}`;
const versionHref = (name: string, id: number): string =>
  `${definitionHref(name)}&id=${String(id)}`;

// One name's card: the wording shown (the selected one, or the newest), its version strip, the
// name's results by version beside the wording's by model, its text, and the runs that used it.
const DefinitionCard: FC<{
  group: DefinitionVersions;
  shown: TestDefinition;
  outcomes: ReadonlyArray<TestResultOutcome>;
}> = ({ group, shown, outcomes }) => {
  const version = group.versions.indexOf(shown) + 1;
  const runs = outcomes
    .filter((row) => row.definitionId === shown.id)
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  return (
    <article class="record definition">
      <h2>{group.name}</h2>
      <nav
        class="definition__versions"
        aria-label={`Versions of ${group.name}`}
        hx-target:inherited="#definitions"
        hx-select:inherited="#definitions"
        hx-swap:inherited="outerHTML"
        hx-push-url:inherited="true"
      >
        {group.versions.map((wording, index) => (
          <a
            href={versionHref(group.name, wording.id)}
            hx-get={versionHref(group.name, wording.id)}
            class={
              wording.id === shown.id
                ? "definition__version definition__version--current"
                : "definition__version"
            }
            aria-current={wording.id === shown.id ? "true" : undefined}
          >
            v{index + 1}
          </a>
        ))}
      </nav>
      <time dateTime={shown.createdAt.toISOString()}>{dateTime.format(shown.createdAt)}</time>
      <div class="definition__chart">
        <ResultChart
          title="Results by version"
          rows={versionStats(group.versions, outcomes).map((row) => ({
            label: `v${String(row.version)}`,
            succeeded: row.succeeded,
            failed: row.failed,
          }))}
        />
        <ResultChart
          title={`Results by model, v${String(version)}`}
          rows={modelStats(runs).map((row) => ({
            label: row.model,
            succeeded: row.succeeded,
            failed: row.failed,
          }))}
        />
      </div>
      <div class="definition__fields">
        <div class="record__field">
          <h3>Description</h3>
          <p>{shown.description}</p>
        </div>
        <div class="record__field">
          <h3>Instruction</h3>
          <p>{shown.instruction}</p>
        </div>
        <div class="record__field">
          <h3>Proof</h3>
          <p>{shown.proof}</p>
        </div>
      </div>
      <div class="record__field definition__runs">
        <h3>Runs of v{version}</h3>
        {runs.length === 0 ? (
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
                    <time dateTime={run.startedAt.toISOString()}>
                      {dateTime.format(run.startedAt)}
                    </time>
                  </td>
                  <td>{run.model ?? "—"}</td>
                  <td>{run.status === "timed_out" ? "timed out" : run.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
};

// Every card is in the page so a narrow screen keeps its scrolling list; the wide layout shows
// the sidebar and only the current card. A sidebar or version click fetches the page for that
// wording and swaps this section in place (htmx 4 inherits an attribute only when told to),
// pushing the URL so a reload or a shared link opens on the same one.
const Definitions: FC<DefinitionsProps> = ({ groups, outcomes, name, id, selected }) => (
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
              // newest wording's id stays the same across the name's versions.
              return (
                <a
                  id={`definition-${String(group.versions[group.versions.length - 1].id)}`}
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
                {groups.some((group) => group.name === name) ? (
                  <p>
                    No version <code>{id}</code> of <code>{name}</code>.
                  </p>
                ) : (
                  <p>
                    No test definition named <code>{name}</code>.
                  </p>
                )}
                <span>Pick one from the list.</span>
              </div>
            ) : null}
            <ol class="definitions__list">
              {groups.map((group) => {
                // Every card shows a name's newest wording but the current one, which shows the
                // wording selected under it.
                const shown =
                  selected !== undefined && selected.name === group.name
                    ? selected
                    : group.versions[group.versions.length - 1];
                return (
                  <li
                    class={
                      group.name === selected?.name
                        ? "definitions__item definitions__item--current"
                        : "definitions__item"
                    }
                  >
                    <DefinitionCard group={group} shown={shown} outcomes={outcomes} />
                  </li>
                );
              })}
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
  const id = context.req.query("id");
  try {
    const [definitions, outcomes] = await Promise.all([
      listTestDefinitions(context.env.HYPERDRIVE.connectionString),
      listTestResultOutcomes(context.env.HYPERDRIVE.connectionString),
    ]);
    const groups = groupDefinitions(definitions);
    const selected = selectDefinition(groups, name, id);
    // A stale link: the page still lists what exists, the status says the name or wording does
    // not. An empty table selects nothing and is not a stale link.
    if (groups.length > 0 && selected === undefined) {
      context.status(404);
    }
    return context.render(
      <Definitions groups={groups} outcomes={outcomes} name={name} id={id} selected={selected} />,
    );
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading the definitions page:", errorMessage(error));
    context.status(500);
    return context.render(
      <Definitions groups={null} outcomes={[]} name={name} id={id} selected={undefined} />,
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

export default Sentry.withSentry(
  () => ({
    dsn: SENTRY_DSN,
    dataCollection: {},
  }),
  app,
);
