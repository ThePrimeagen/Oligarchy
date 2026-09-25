import * as Sentry from "@sentry/cloudflare";
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { type Context, Hono } from "hono";
import { html } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import {
  abortAutomationJob,
  addServer,
  abortPendingSuiteJobs,
  abortTestSuite,
  listOpenSuiteJobs,
  definitionStats,
  deleteOldRows,
  getImage,
  groupDefinitions,
  listAutomationQueue,
  listDefinitionHistories,
  listDefinitionRuns,
  listRunningAutomationJobs,
  runningForDefinition,
  readTestDump,
  readSessionFollow,
  listProcessSeries,
  listServers,
  listSessions,
  listTestBasePrompts,
  listTestDefinitions,
  NO_DEFINITION_RESULTS,
  removeServer,
  RETENTION_DAYS,
  reviseTestDefinition,
  selectDefinition,
  type DefinitionStat,
  type Session,
  type SessionFollow,
  type TestBasePrompt,
} from "./query.ts";
import { clickerPage } from "./clicker.ts";
import { TestMissingPage, TestPage, TestUnavailablePage } from "./diagnostic.tsx";
import {
  definitionHref,
  DefinitionHistories,
  DefinitionsPage,
  RunningList,
  type EditNotice,
} from "./definitions.tsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";
import { FollowBody, FollowFrame } from "./follow.tsx";
import { Fleet, type Halves, Process, Queue, ServersPage } from "./servers.tsx";
import { createTestSuiteRun, SuiteRequestError } from "./suite.ts";
import { isTicket } from "./ticket.ts";
import * as Linear from "@oligarchy/linear/client";
import * as Dsn from "@oligarchy/observability/dsn";

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
  // The Linear team POST /create-test-suite-run files tickets on. A wrangler secret, no default.
  LINEAR_TEAM: string;
  // A Cloudflare var beside the automation server's url, so the integration lane can point it at
  // a stub: no test calls Linear.
  LINEAR_API_URL: string;
  // wrangler secret; a personal API key, which Linear takes raw, with no `Bearer`.
  LINEAR_API_TOKEN: string;
};

// The dashboard's one Linear call: an aborted job's ticket moves to the board's Aborted status,
// so the ticket says what the queue says. Rejects with the reason when the ticket did not move:
// the route logs it and answers all the same. A runtime per call, as the worker has no process
// to hold one.
const abortLinearIssue = async (env: Bindings, ticket: string): Promise<void> => {
  const runtime = ManagedRuntime.make(
    Linear.Linear.layer(
      Redacted.make(env.LINEAR_API_TOKEN),
      env.LINEAR_TEAM,
      env.LINEAR_API_URL,
    ).pipe(Layer.provide(FetchHttpClient.layer)),
  );
  try {
    await runtime.runPromise(
      Effect.flatMap(Linear.Linear, (client) => client.moveToAborted(ticket)),
    );
  } finally {
    await runtime.dispose();
  }
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

const sessionStatusText = (sessions: Session[] | null) => {
  if (sessions === null) {
    return "Sessions unavailable";
  }
  if (sessions.length === 0) {
    return "No sessions recorded";
  }
  return (
    <>
      Updated{" "}
      <time dateTime={sessions[0].queriedAt.toISOString()}>
        {dateTime.format(sessions[0].queriedAt)}
      </time>
    </>
  );
};

const SessionStatus: FC<SessionStatusProps> = ({ sessions, outOfBand = false }) => (
  <span id="session-status" hx-swap-oob={outOfBand ? "innerHTML" : undefined}>
    {sessionStatusText(sessions)}
  </span>
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

type PageId = "results" | "definitions" | "prompts" | "follow";

const PAGES = [
  { id: "results", href: "/results", label: "Test results" },
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
      <div class="brand" aria-label="oligarchy">
        oligarchy
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

const editHref = (name: string, notice: EditNotice): string =>
  `${definitionHref(name)}?edit=${notice}`;

type PromptsProps = {
  prompts: TestBasePrompt[] | null;
};

const promptsList = (prompts: TestBasePrompt[] | null) => {
  if (prompts === null) {
    return (
      <div class="empty-state empty-state--error">
        <p>Base prompts are unavailable.</p>
        <span>Try refreshing in a moment.</span>
      </div>
    );
  }
  if (prompts.length === 0) {
    return (
      <div class="empty-state">
        <p>No base prompts yet.</p>
      </div>
    );
  }
  return (
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
  );
};

const Prompts: FC<PromptsProps> = ({ prompts }) => (
  <Shell page="prompts">
    <section class="records" aria-labelledby="prompts-heading">
      <div class="sessions__heading">
        <h1 id="prompts-heading">Base prompts</h1>
      </div>
      <div class="record-list">{promptsList(prompts)}</div>
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
        <title>oligarchy</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/dashboard.css" />
        <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
        <script src="/dashboard.js" defer></script>
      </head>
      <body>{children}</body>
    </html>
  )),
);

app.get("/results", async (context) => {
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

// Text, served whole, the same document as the servers page.
const definitionsPage = (
  context: Context<{ Bindings: Bindings }>,
  status: 200 | 404 | 500,
  props: Parameters<typeof DefinitionsPage>[0],
) => context.html(html`<!doctype html>${<DefinitionsPage {...props} />}`, status);

// An old ?name link is the previous address of a definition's page. Empty is the index.
const legacyDefinition = (name: string, edit: string | undefined): string =>
  name === ""
    ? "/definitions"
    : `${definitionHref(name)}${edit === undefined ? "" : `?edit=${encodeURIComponent(edit)}`}`;

// Only the two refusals the edit route redirects with are a notice; anything else in ?edit is
// a stale or hand-made link and shows nothing.
const editNotice = (edit: string | undefined): EditNotice | undefined =>
  edit === "unchanged" || edit === "empty" ? edit : undefined;

app.get("/definitions", async (context) => {
  const name = context.req.query("name");
  if (name !== undefined) {
    return context.redirect(legacyDefinition(name, context.req.query("edit")), 302);
  }
  try {
    const [definitions, running, histories] = await Promise.all([
      listTestDefinitions(context.env.HYPERDRIVE.connectionString),
      listRunningAutomationJobs(context.env.HYPERDRIVE.connectionString),
      listDefinitionHistories(context.env.HYPERDRIVE.connectionString),
    ]);
    return definitionsPage(context, 200, {
      groups: groupDefinitions(definitions),
      name: undefined,
      selected: undefined,
      notice: undefined,
      error: undefined,
      running,
      histories,
      results: NO_DEFINITION_RESULTS,
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading the definitions page:", errorMessage(error));
    return definitionsPage(context, 500, {
      groups: null,
      name: undefined,
      selected: undefined,
      notice: undefined,
      error: "Test definitions are unavailable.",
      running: null,
      histories: [],
      results: NO_DEFINITION_RESULTS,
    });
  }
});

// What the running strip polls for: the jobs in flight, not the rest of the page. `name` is the
// definition an abort without htmx returns to, echoed into the forms the swap inserts, and the
// name whose jobs this fragment keeps. Registered before /definitions/:name so this path is the
// fragment, not a definition named running.
app.get("/definitions/running", async (context) => {
  const definition = context.req.query("name");
  try {
    const running = await listRunningAutomationJobs(context.env.HYPERDRIVE.connectionString);
    const jobs = definition === undefined ? running : runningForDefinition(running, definition);
    return context.html(<RunningList jobs={jobs} definition={definition} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing running tests:", errorMessage(error));
    return context.html(<p>error: internal error</p>, 500);
  }
});

// What the pills on screen ask for once a minute. One block per requested name, not a page, and
// not a definition named histories. No names is an empty body, not a look at the database.
app.get("/definitions/histories", async (context) => {
  const names = context.req.queries("name") ?? [];
  if (names.length === 0) {
    return context.text("");
  }
  try {
    const histories = await listDefinitionHistories(context.env.HYPERDRIVE.connectionString, names);
    return context.html(<DefinitionHistories names={names} histories={histories} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing definition histories:", errorMessage(error));
    return context.html(<p>error: internal error</p>, 500);
  }
});

// One definition: /definitions/lock-screen. A name nobody carries is 404, not another definition.
app.get("/definitions/:name", async (context) => {
  const name = context.req.param("name");
  const notice = editNotice(context.req.query("edit"));
  try {
    const [definitions, running, results] = await Promise.all([
      listTestDefinitions(context.env.HYPERDRIVE.connectionString),
      listRunningAutomationJobs(context.env.HYPERDRIVE.connectionString),
      listDefinitionRuns(context.env.HYPERDRIVE.connectionString, name),
    ]);
    const selected = selectDefinition(groupDefinitions(definitions), name);
    return definitionsPage(context, selected === undefined ? 404 : 200, {
      groups: null,
      name,
      selected,
      notice,
      error: undefined,
      running: runningForDefinition(running, name),
      histories: [],
      results,
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading a definition:", errorMessage(error));
    return definitionsPage(context, 500, {
      groups: null,
      name,
      selected: undefined,
      notice: undefined,
      error: "Test definitions are unavailable.",
      running: null,
      histories: [],
      results: NO_DEFINITION_RESULTS,
    });
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
    return definitionsPage(context, 500, {
      groups: null,
      name,
      selected: undefined,
      notice: undefined,
      error: "Test definitions are unavailable.",
      running: null,
      histories: [],
      results: NO_DEFINITION_RESULTS,
    });
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

// Invalid before any database call. A missing ticket is a 404 with no poll. A database that
// cannot be reached is a 500 that never echoes the connection string. The feed is the fragment
// the poll swaps into #follow, so it does not carry its own trigger.
const lookupFollow = async (
  context: Context<{ Bindings: Bindings }>,
  ticket: string,
): Promise<
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" }
  | { readonly kind: "down" }
  | { readonly kind: "ok"; readonly follow: SessionFollow }
> => {
  if (!isTicket(ticket)) {
    return { kind: "invalid" };
  }
  try {
    const follow = await readSessionFollow(context.env.HYPERDRIVE.connectionString, ticket);
    return follow === undefined ? { kind: "missing" } : { kind: "ok", follow };
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: reading the session feed:", errorMessage(error));
    return { kind: "down" };
  }
};

app.get("/tickets/:ticket/feed", async (context) => {
  const ticket = context.req.param("ticket");
  const looked = await lookupFollow(context, ticket);
  if (looked.kind === "invalid") {
    return context.notFound();
  }
  if (looked.kind === "missing") {
    return context.html(<p>No ticket named {ticket}.</p>, 404);
  }
  if (looked.kind === "down") {
    return context.html(<p>error: internal error</p>, 500);
  }
  return context.html(<FollowBody follow={looked.follow} />);
});

app.get("/tickets/:ticket", async (context) => {
  const ticket = context.req.param("ticket");
  const looked = await lookupFollow(context, ticket);
  if (looked.kind === "invalid") {
    return context.notFound();
  }
  if (looked.kind === "missing") {
    context.status(404);
    return context.render(
      <Shell page="follow">
        <section class="follow">
          <p>No ticket named {ticket}.</p>
        </section>
      </Shell>,
    );
  }
  if (looked.kind === "down") {
    context.status(500);
    return context.render(
      <Shell page="follow">
        <section class="follow">
          <div class="empty-state empty-state--error">
            <p>The session feed is unavailable.</p>
            <span>Try refreshing in a moment.</span>
          </div>
        </section>
      </Shell>,
    );
  }
  return context.render(
    <Shell page="follow">
      <section class="follow" aria-labelledby="follow-heading">
        <FollowFrame follow={looked.follow} />
      </section>
    </Shell>,
  );
});

const RESULT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One result, dumped. An id that is not a uuid is not looked up: the column would refuse it.
// /tests is the address the index pills already use. A definition's page links /test-results.
const testResultPage = async (context: Context<{ Bindings: Bindings }>, id: string) => {
  if (!RESULT_ID.test(id)) {
    return context.html(html`<!doctype html>${<TestMissingPage />}`, 404);
  }
  try {
    const dump = await readTestDump(context.env.HYPERDRIVE.connectionString, id);
    if (dump === undefined) {
      return context.html(html`<!doctype html>${<TestMissingPage />}`, 404);
    }
    return context.html(html`<!doctype html>${<TestPage dump={dump} />}`);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading a test:", errorMessage(error));
    return context.html(html`<!doctype html>${<TestUnavailablePage />}`, 500);
  }
};

app.get("/tests/:id", (context) => testResultPage(context, context.req.param("id")));
app.get("/test-results/:id", (context) => testResultPage(context, context.req.param("id")));

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

// The homepage, and /servers: text served whole, not through the renderer.
// Its two halves are rows: the automation queue the webhook and the worker write
// (automation_jobs), and the fleet the servers themselves write every thirty seconds
// (src/qemu-server/heartbeat.ts). Below them, process_stats is the series each announcing
// process wrote of itself, drawn as graphs. `halves` is absent only when the database
// could not be read, so a 500 page claims neither an empty queue nor an empty fleet.
const readHalves = async (connectionString: string): Promise<Halves> => {
  const [queue, servers, process] = await Promise.all([
    listAutomationQueue(connectionString),
    listServers(connectionString),
    listProcessSeries(connectionString),
  ]);
  return { queue, servers, process };
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

const serveServers = async (context: Context<{ Bindings: Bindings }>) => {
  try {
    const halves = await readHalves(context.env.HYPERDRIVE.connectionString);
    return await serversPage(context, 200, halves);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: reading the servers page:", errorMessage(error));
    return serversPage(context, 500, undefined, "internal error");
  }
};

app.get("/", serveServers);
app.get("/servers", serveServers);

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

// What the process graphs' poll swaps in.
app.get("/servers/process", async (context) => {
  try {
    const series = await listProcessSeries(context.env.HYPERDRIVE.connectionString);
    return context.html(<Process series={series} />);
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: listing process stats:", errorMessage(error));
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

// POST /abort stops one job, named by its ticket and action as the page's form posts them (a
// ticket has one drive and one diagnose), and moves the ticket to Aborted on the board. A
// pending job has no client to stop: closing its row here is the whole abort, and the
// dispatcher's next claim no longer finds it. A running job is the automation server's to
// stop, and a 200 from that server is the close; it refuses a job that is not the one
// running for the ticket, so a stale click cannot stop the other. A 4xx or 5xx, or no answer
// at all, closes the running row here so the queue does not stay stuck; Sentry records
// "Cloudflare aborted job" only when that write lands. Once a row closed either way the
// ticket moves; a Linear failure is logged and the row stays closed. This route always
// answers 200 when htmx or JSON asked, and a plain form post redirects. The servers page
// gets the queue or /servers. A form that posts view=definitions gets the running list, or
// /definitions, so aborting there does not land on the servers page. The operator's click
// is done either way.
// OpenCode's force-kill is 5s; ten seconds is that wait plus the round trip. A hung
// server must not hold the operator's 200.
const ABORT_TIMEOUT_MS = 10_000;

app.post("/abort", async (context) => {
  const wantsFragment = context.req.header("hx-request") === "true";
  const isJson = (context.req.header("content-type") ?? "").includes("application/json");
  let view: unknown;
  let definition: unknown;
  const reply = async () => {
    const definitionsView = view === "definitions";
    // An empty name is not a page: the index is. A name goes back to that definition's page.
    const back = typeof definition === "string" && definition !== "" ? definition : undefined;
    if (wantsFragment) {
      try {
        if (definitionsView) {
          const running = await listRunningAutomationJobs(context.env.HYPERDRIVE.connectionString);
          const jobs = back === undefined ? running : runningForDefinition(running, back);
          return context.html(<RunningList jobs={jobs} definition={back} />);
        }
        const queue = await listAutomationQueue(context.env.HYPERDRIVE.connectionString);
        return context.html(<Queue queue={queue} />);
      } catch (error) {
        Sentry.captureException(error);
        console.error("dashboard: aborting a job:", errorMessage(error));
        return context.html(<p>error: internal error</p>);
      }
    }
    if (isJson) {
      return context.json({ ok: "true" });
    }
    if (definitionsView) {
      return context.redirect(back === undefined ? "/definitions" : definitionHref(back), 303);
    }
    return context.redirect("/servers", 303);
  };
  try {
    let ticket: unknown;
    let action: unknown;
    if (isJson) {
      const body: unknown = await context.req.json();
      if (typeof body === "object" && body !== null && "ticket" in body && "action" in body) {
        ticket = body.ticket;
        action = body.action;
      }
    } else {
      const body = await context.req.parseBody();
      ticket = body.ticket;
      action = body.action;
      view = body.view;
      definition = body.definition;
    }
    // A post naming less than a job (a text ticket and one of the two actions) does nothing.
    if (
      typeof ticket === "string" &&
      ticket !== "" &&
      (action === "drive" || action === "diagnose" || action === "mint")
    ) {
      let closed = false;
      try {
        closed = await abortAutomationJob(
          context.env.HYPERDRIVE.connectionString,
          ticket,
          action,
          "pending",
        );
      } catch (error) {
        Sentry.captureException(error);
        console.error("dashboard: aborting a job:", errorMessage(error));
      }
      if (!closed) {
        try {
          const response = await fetch(new URL("/abort", context.env.AUTOMATION_SERVER_URL), {
            method: "POST",
            headers: {
              authorization: `Bearer ${context.env.OLIGARCHY_TOKEN}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ ticket, action }),
            signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
          });
          closed = response.status === 200;
          if (!closed) {
            console.error(
              `dashboard: aborting a job: automation server returned ${String(response.status)}`,
            );
          }
        } catch (error) {
          console.error("dashboard: aborting a job:", errorMessage(error));
        }
      }
      if (!closed) {
        try {
          closed = await abortAutomationJob(
            context.env.HYPERDRIVE.connectionString,
            ticket,
            action,
            "running",
          );
          if (closed) {
            Sentry.captureException(new Error("Cloudflare aborted job"));
          }
        } catch (error) {
          Sentry.captureException(error);
          console.error("dashboard: aborting a job:", errorMessage(error));
        }
      }
      if (closed) {
        try {
          await abortLinearIssue(context.env, ticket);
        } catch (error) {
          Sentry.captureException(error);
          console.error(
            `dashboard: aborting a job: ${ticket} stays on the board:`,
            errorMessage(error),
          );
        }
      }
    }
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: aborting a job:", errorMessage(error));
  }
  return reply();
});

// A uuid, the shape test_runs.id has. Anything else is not a suite to abort.
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /suites/abort stops one suite that never finished. Pending jobs abort here first, the
// same way /abort does, so a claim during the round trip never sees them. A running job is the
// automation server's to stop. A miss still aborts the row here, same as /abort's running
// fallback, and the client may still be driving; the VM itself ends when commands stop. The
// results still pending or running become aborted, which is what takes the suite out of the
// running count, and each of their tickets moves to Aborted. A suite that has already finished
// is left as it is. A Linear miss is logged and the rows stay aborted. The click answers with
// the queue.
app.post("/suites/abort", async (context) => {
  const wantsFragment = context.req.header("hx-request") === "true";
  const connectionString = context.env.HYPERDRIVE.connectionString;
  const reply = async () => {
    if (!wantsFragment) {
      return context.redirect("/servers", 303);
    }
    try {
      const queue = await listAutomationQueue(connectionString);
      return context.html(<Queue queue={queue} />);
    } catch (error) {
      Sentry.captureException(error);
      console.error("dashboard: aborting a suite:", errorMessage(error));
      return context.html(<p>error: internal error</p>);
    }
  };
  try {
    const body = await context.req.parseBody();
    const run = body.run;
    if (typeof run !== "string" || !RUN_ID.test(run)) {
      return reply();
    }
    await abortPendingSuiteJobs(connectionString, run);
    // The first pass is the slow one. A claim that won the pending abort shows up on
    // the second. A job that becomes running during that second pass is still running
    // afterwards; that window is one read, not the whole abort loop.
    const stopRunning = async (): Promise<boolean> => {
      const jobs = await listOpenSuiteJobs(connectionString, run);
      let missed = false;
      for (const job of jobs) {
        if (job.ticket === null) {
          missed = true;
          continue;
        }
        try {
          const response = await fetch(new URL("/abort", context.env.AUTOMATION_SERVER_URL), {
            method: "POST",
            headers: {
              authorization: `Bearer ${context.env.OLIGARCHY_TOKEN}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ ticket: job.ticket, action: job.action }),
            signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
          });
          if (response.status !== 200) {
            missed = true;
            console.error(
              `dashboard: aborting a suite: automation server returned ${String(response.status)}`,
            );
          }
        } catch (error) {
          missed = true;
          console.error("dashboard: aborting a suite:", errorMessage(error));
        }
      }
      return missed;
    };
    const missedFirst = await stopRunning();
    const missed = (await stopRunning()) || missedFirst;
    const suite = await abortTestSuite(connectionString, run);
    if (suite.aborted && missed) {
      Sentry.captureException(new Error("Cloudflare aborted job"));
    }
    if (suite.aborted) {
      for (const ticket of suite.tickets) {
        try {
          await abortLinearIssue(context.env, ticket);
        } catch (error) {
          Sentry.captureException(error);
          console.error(
            `dashboard: aborting a suite: ${ticket} stays on the board:`,
            errorMessage(error),
          );
        }
      }
    }
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: aborting a suite:", errorMessage(error));
  }
  return reply();
});

// The same run as `./ctrl test run testsuite`, which is all this route does. Not linked from a
// page yet. The button belongs beside the definitions heading, not on a selected definition: the
// suite is every name's newest wording but mint's, and a button on one definition would read as
// running that one name (`./ctrl test run --name`). It posts iso, version and serverUrl here and
// shows the run id and ticket identifiers this answers with, and it stays disabled when no
// definition but mint is stored.
// Until that form exists the route takes JSON only, those three fields.
app.post("/create-test-suite-run", async (context) => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "iso, version and serverUrl are required" }, 400);
  }
  try {
    const created = await createTestSuiteRun(
      context.env,
      context.env.HYPERDRIVE.connectionString,
      body,
    );
    return context.json(created);
  } catch (error) {
    if (error instanceof SuiteRequestError) {
      return context.json({ error: error.message }, 400);
    }
    Sentry.captureException(error);
    console.error("dashboard: create test-suite-run:", errorMessage(error));
    return context.json({ error: errorMessage(error) }, 500);
  }
});

// The retention sweep, run by Cloudflare on the cron in wrangler.jsonc. One line says what went;
// a failure is thrown, so the cron event is recorded as failed and Sentry's wrapper reports it.
export const scheduled = async (
  controller: { readonly cron: string },
  env: Bindings,
): Promise<void> => {
  const deleted = await deleteOldRows(env.HYPERDRIVE.connectionString);
  const counts = Object.entries(deleted)
    .map(([table, rows]) => `${table} ${String(rows)}`)
    .join(", ");
  console.log(
    `dashboard: cron ${controller.cron} deleted rows older than ${String(RETENTION_DAYS)} days: ${counts}`,
  );
};

// Cloudflare reads fetch and scheduled off the default export. The Hono app stays the handler,
// so Sentry keeps hooking its error handler for a route that throws; the cron is added to it.
export default Sentry.withSentry(
  () => ({
    dsn: Dsn.SENTRY_DSN,
    dataCollection: {},
  }),
  Object.assign(app, { scheduled }),
);
