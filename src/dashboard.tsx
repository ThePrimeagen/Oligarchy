import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import { SENTRY_DSN } from "./sentry-dsn.ts";

const HTMX_URL = "https://cdn.jsdelivr.net/npm/htmx.org@4.0.0";
const HTMX_INTEGRITY = "sha384-BvJpBiO8Kh31EqtJe5DRIeWrHWnCGkwytKs9NKFi86Hhw96dEqdEMzZDeK9iEGTc";

type GreetingProps = {
  message: string;
};

const Greeting: FC<GreetingProps> = ({ message }) => <h1 id="greeting">{message}</h1>;

const app = new Hono();

app.use(
  jsxRenderer(({ children }) => (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Oligarchy</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/dashboard.css" />
        <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
      </head>
      <body>{children}</body>
    </html>
  )),
);

app.get("/", (context) =>
  context.render(
    <main>
      <p>Oligarchy dashboard</p>
      <Greeting message="Hello world" />
      <button hx-get="/greeting" hx-target="#greeting" hx-swap="outerHTML">
        Say hello again
      </button>
    </main>,
  ),
);

app.get("/greeting", (context) => context.html(<Greeting message="Hello again" />));

export default Sentry.withSentry(
  () => ({
    dsn: SENTRY_DSN,
    dataCollection: {},
  }),
  app,
);
