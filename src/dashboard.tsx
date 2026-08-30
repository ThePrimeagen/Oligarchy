import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import { getSessionImage, listSessions, type Session } from "./db/query.ts";
import { SENTRY_DSN } from "./sentry-dsn.ts";

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
      {sessions.map((session) => {
        const isoName = session.config.iso.split("/").at(-1) ?? session.config.iso;
        return (
          <li>
            <article class="session">
              <figure class="session__visual">
                {session.imageActionId === null ? (
                  <div class="session__placeholder" role="img" aria-label="No screenshot captured"></div>
                ) : (
                  <img
                    class="session__image"
                    src={`/images/${session.imageActionId}`}
                    alt={`Last captured frame from session ${session.id}`}
                    loading="lazy"
                  />
                )}
                <span
                  class={`status status--${session.status}${session.imageActionId === null ? " status--centered" : ""}`}
                >
                  {session.status === "timed_out" ? "timed out" : session.status}
                </span>
              </figure>
              <div class="session__details">
                <div class="session__version">
                  <span>Omarchy version</span>
                  <a href={session.config.iso}>{isoName}</a>
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
    Sentry.captureException(error);
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
    Sentry.captureException(error);
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

app.get("/images/:actionId", async (context) => {
  const actionId = Number(context.req.param("actionId"));
  if (!Number.isSafeInteger(actionId) || actionId < 1) {
    return context.notFound();
  }

  try {
    const image = await getSessionImage(context.env.HYPERDRIVE.connectionString, actionId);
    if (image === undefined) {
      return context.notFound();
    }
    return new Response(new Uint8Array(image), {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": "image/png",
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("dashboard: loading session image:", (error as Error).message);
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
