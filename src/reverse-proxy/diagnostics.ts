import { Cause, Effect, Result, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import type * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import type * as Errors from "../shared/errors.ts";
import * as Router from "./router.ts";

// The one form the page posts, from the add box and from a row's delete button alike.
const Form = Schema.Struct({ url: Domain.ServerUrl });
const decodeForm = HttpServerRequest.schemaBodyUrlParams(Form);

const URL_RULE = "url must be an http or https url";

// A registered url is the operator's text: it goes into the page as text, never as markup.
const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const gigabytes = (bytes: number): string => (bytes / 1_000_000_000).toFixed(1);

const row = (server: Contract.Server): string => {
  const url = escape(server.url);
  const probe =
    server.stats === null
      ? `<td colspan="3">did not answer</td>`
      : `<td>${String(server.stats.qemus)}</td><td>${gigabytes(server.stats.memory.usedBytes)} / ${gigabytes(server.stats.memory.totalBytes)} GB</td><td>${server.stats.cpu.mean.toFixed(1)}%</td>`;
  return `<tr><td>${url}</td>${probe}<td><form method="post" action="/servers/delete"><input type="hidden" name="url" value="${url}"><button>delete</button></form></td></tr>`;
};

const fleet = (servers: ReadonlyArray<Contract.Server>): string =>
  servers.length === 0
    ? "<p>no servers registered</p>"
    : `<table>
<tr><th>url</th><th>qemus</th><th>memory</th><th>cpu</th><th></th></tr>
${servers.map(row).join("\n")}
</table>`;

// Unstyled on purpose: text an operator reads at a glance. `servers` is absent only when the
// database could not be read, so a 500 page does not claim an empty fleet.
const page = (servers: ReadonlyArray<Contract.Server> | undefined, error?: string): string =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>oligarchy reverse proxy</title></head>
<body>
<h1>oligarchy reverse proxy</h1>
${error === undefined ? "" : `<p>error: ${escape(error)}</p>\n`}<h2>servers</h2>
${servers === undefined ? "" : `${fleet(servers)}\n`}<h2>add a server</h2>
<form method="post" action="/servers"><input name="url" size="60" placeholder="https://qemu.example.com"><button>add</button></form>
</body>
</html>
`;

const html = (status: number, body: string): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text(body, { status, contentType: "text/html; charset=utf-8" });

// After a successful add or delete the browser fetches the page afresh.
const back = HttpServerResponse.redirect("/", { status: 303 });

const notFound = HttpServerResponse.text("not found", { status: 404 });

// The diagnostics page: the fleet with a delete button per server and an add box, on its own
// loopback port and without a token, because a browser has no bearer to send. Three routes on a
// switch: a router here would share the API's `HttpRouter` instance and serve its routes too.
export const handler: Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | Router.Router | Log.Log
> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const router = yield* Router.Router;
  const log = yield* Log.Log;
  const path = new URL(request.url, "http://diagnostics").pathname;
  const line = (text: string) => `${request.method} ${request.url} failed: ${text}`;

  // As the API boundary: one line per refused request, Sentry only from 500 up. The page comes
  // back whole, the reason on top, so the operator can act on it where they are.
  const refused = (
    status: number,
    message: string,
    cause?: unknown,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, Errors.Internal> =>
    Effect.gen(function* () {
      yield* log.error(line(message), status < 500 ? { skipSentry: true } : { cause });
      const servers = yield* router.servers;
      return html(status, page(servers.servers, message));
    });

  const form = decodeForm.pipe(Effect.result);

  const respond = Effect.gen(function* () {
    switch (`${request.method} ${path}`) {
      case "GET /": {
        const servers = yield* router.servers;
        return html(200, page(servers.servers));
      }
      case "POST /servers": {
        const submitted = yield* form;
        if (Result.isFailure(submitted)) {
          return yield* refused(400, URL_RULE);
        }
        return yield* router.register(submitted.success.url).pipe(
          Effect.as(back),
          Effect.catchTag("ServerFailed", (error) => refused(502, error.message, error.cause)),
        );
      }
      case "POST /servers/delete": {
        const submitted = yield* form;
        if (Result.isFailure(submitted)) {
          return yield* refused(400, URL_RULE);
        }
        const url = submitted.success.url;
        return yield* router.unregister(url).pipe(
          Effect.as(back),
          Effect.catchTag("NotFound", () => refused(404, `${url} is not registered`)),
        );
      }
      default:
        return notFound;
    }
  });

  return yield* respond.pipe(
    Effect.catchTag("Internal", (error) =>
      log
        .error(line(Render.errorDetail(ExternalFailure.causeOf(error.cause))), {
          cause: error.cause,
        })
        .pipe(Effect.as(html(500, page(undefined, "internal error")))),
    ),
    Effect.catchDefect((defect) =>
      log
        .error(line(Cause.pretty(Cause.die(defect))), { cause: defect })
        .pipe(Effect.as(html(500, page(undefined, "internal error")))),
    ),
  );
});
