import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import { listSessions, type Session } from "./db/query.ts";

const HTMX_URL = "https://cdn.jsdelivr.net/npm/htmx.org@4.0.0";
const HTMX_INTEGRITY = "sha384-BvJpBiO8Kh31EqtJe5DRIeWrHWnCGkwytKs9NKFi86Hhw96dEqdEMzZDeK9iEGTc";

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
    {sessions === null
      ? "Sessions unavailable"
      : sessions.length === 0
        ? "No sessions recorded"
        : (
            <>
              Updated{" "}
              <time dateTime={sessions[0].queriedAt.toISOString()}>{dateTime.format(sessions[0].queriedAt)}</time>
            </>
          )}
  </span>
);

const SessionList: FC<SessionListProps> = ({ sessions }) => (
  sessions.length === 0 ? (
    <div class="empty-state">
      <p>No sessions recorded yet.</p>
    </div>
  ) : (
    <ol>
      {sessions.map((session) => (
        <li>
          <article class="session">
            <div class="session__heading">
              <code>{session.id}</code>
              <span class={`status status--${session.status}`}>{session.status}</span>
            </div>
            <dl>
              <div>
                <dt>Image</dt>
                <dd>{session.config.iso}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>
                  <time dateTime={session.startedAt.toISOString()}>{dateTime.format(session.startedAt)}</time>
                </dd>
              </div>
              <div>
                <dt>Ended</dt>
                <dd>
                  {session.endedAt === null ? (
                    "In progress"
                  ) : (
                    <time dateTime={session.endedAt.toISOString()}>{dateTime.format(session.endedAt)}</time>
                  )}
                </dd>
              </div>
              {session.config.disk === undefined ? null : (
                <div>
                  <dt>Disk</dt>
                  <dd>{session.config.disk}</dd>
                </div>
              )}
            </dl>
            {session.reason === null ? null : <p class="session__reason">{session.reason}</p>}
          </article>
        </li>
      ))}
    </ol>
  )
);

const SessionError: FC = () => (
  <div class="empty-state empty-state--error">
    <p>Sessions are unavailable.</p>
    <span>Try refreshing in a moment.</span>
  </div>
);

type HomeProps = {
  sessions: Session[] | null;
};

const Home: FC<HomeProps> = ({ sessions }) => (
  <main>
    <header class="hero">
      <p class="hero__eyebrow">QEMU session archive</p>
      <div class="brand" aria-label="Omarchy">
        OMARCHY
      </div>
      <p class="hero__intro">Machines driven by agents, recorded from first boot to final verdict.</p>
    </header>

    <section class="sessions" aria-labelledby="sessions-heading">
      <div class="sessions__heading">
        <div>
          <p class="sessions__eyebrow">Control plane</p>
          <h1 id="sessions-heading">Sessions</h1>
        </div>
        <button class="button" type="button" hx-get="/sessions" hx-target="#session-list" hx-swap="innerHTML">
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
  </main>
);

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  jsxRenderer(({ children }) => (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1a1b26" />
        <title>Omarchy Sessions</title>
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
    console.error("dashboard: listing sessions:", (error as Error).message);
    context.status(500);
    return context.render(<Home sessions={null} />);
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
    console.error("dashboard: listing sessions:", (error as Error).message);
    return context.html(
      <>
        <SessionStatus sessions={null} outOfBand />
        <SessionError />
      </>,
      500,
    );
  }
});

export default app;
