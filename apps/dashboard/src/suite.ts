import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Client from "@oligarchy/db/client";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as Open from "@oligarchy/jobs/open";
import * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import clientMd from "../../../client.md";
import ctrlLinearMd from "../../../ctrl-linear.md";
import linearIssue from "../../../prompts/linear-issue.html";

// POST /create-test-suite-run opens the same run as `./ctrl test run testsuite`, through
// Jobs.open. The worker has no checkout, so the files the ticket template reads (the template
// and the two guides it embeds) are these strings, the same files wrangler loads as text.

const REQUIRED = "iso, version and serverUrl are required";

// A suite request the route refuses with 400: a body missing a field, a url that is not one, or
// no test definition to open a run from.
export class SuiteRequestError extends Schema.TaggedError<SuiteRequestError>(
  "@oligarchy/dashboard/suite/SuiteRequestError",
)("SuiteRequestError", { message: Schema.String }) {}

export const isSuiteRequestError = Schema.is(SuiteRequestError);

type SuiteBody = {
  readonly iso: string;
  readonly version: string;
  readonly serverUrl: string;
};

type SuiteRunner = (
  connectionString: string,
  token: string,
  team: string,
  request: SuiteBody,
) => Promise<unknown>;

const fieldsOf = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withHost = (value: string, protocol: "http:" | "https:"): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return url.protocol === protocol && url.hostname !== "";
};

const readBody = (body: unknown): SuiteBody => {
  const fields = fieldsOf(body) ? body : undefined;
  const iso = fields?.iso;
  const version = fields?.version;
  const serverUrl = fields?.serverUrl;
  if (
    typeof iso !== "string" ||
    iso === "" ||
    typeof version !== "string" ||
    version === "" ||
    typeof serverUrl !== "string" ||
    serverUrl === ""
  ) {
    throw SuiteRequestError.make({ message: REQUIRED });
  }
  if (!withHost(iso, "https:")) {
    throw SuiteRequestError.make({ message: "iso must be a valid https url" });
  }
  if (!withHost(serverUrl, "http:") && !withHost(serverUrl, "https:")) {
    throw SuiteRequestError.make({ message: "serverUrl must be a valid http or https url" });
  }
  return { iso, version, serverUrl };
};

const promptText = (path: string): string | undefined => {
  if (path.endsWith("/prompts/linear-issue.html")) {
    return linearIssue;
  }
  if (path.endsWith("/client.md")) {
    return clientMd;
  }
  if (path.endsWith("/ctrl-linear.md")) {
    return ctrlLinearMd;
  }
  return undefined;
};

// What the ticket template reads through. A path this command does not ask for dies: an empty stand-in
// would publish a ticket with the placeholder still in it.
export const bundledPrompts: Layer.Layer<FileSystem.FileSystem> = FileSystem.layerNoop({
  readFileString: (path) => {
    const text = promptText(path);
    return text === undefined
      ? Effect.die(new Error(`test run testsuite: no prompt at ${path}`))
      : Effect.succeed(text);
  },
});

const NO_DEFINITIONS = "test: no test definitions found";

const commandMessage = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return undefined;
  }
  if (!("_tag" in error) || error._tag !== "CommandError") {
    return undefined;
  }
  return typeof error.message === "string" ? error.message : undefined;
};

// A runtime per request, as the worker has no process to hold one: the database and its
// TestStore, Linear, lines to stdout, and the bundled templates as the file system. The token
// and team are read as ctrl reads them, before anything is built, so an empty LINEAR_TEAM is
// refused by name without a query or a Linear call.
const openSuite: SuiteRunner = async (connectionString, token, team, request) => {
  const runtime = ManagedRuntime.make(
    Layer.unwrap(
      Effect.map(Config.linearAccess, (access) =>
        Layer.mergeAll(
          Tests.TestStore.layer.pipe(
            Layer.provide(Client.Database.layer(Redacted.make(connectionString))),
          ),
          Linear.Linear.layer(access.token, access.team).pipe(Layer.provide(FetchHttpClient.layer)),
          Log.Log.layerStdout,
          bundledPrompts,
        ),
      ),
    ).pipe(Layer.provide(Config.fromValues({ LINEAR_API_TOKEN: token, LINEAR_TEAM: team }))),
  );
  let exit: Exit.Exit<unknown, unknown>;
  try {
    exit = await runtime.runPromiseExit(Open.open({ ...request, name: Option.none() }));
  } finally {
    await runtime.dispose();
  }
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    throw error instanceof Error ? error : new Error(String(error));
  }
  return exit.value;
};

export const createTestSuiteRun = async (
  env: { readonly LINEAR_API_TOKEN: string; readonly LINEAR_TEAM: string },
  connectionString: string,
  body: unknown,
  run: SuiteRunner = openSuite,
): Promise<unknown> => {
  const request = readBody(body);
  try {
    return await run(connectionString, env.LINEAR_API_TOKEN, env.LINEAR_TEAM, request);
  } catch (error) {
    if (commandMessage(error) === NO_DEFINITIONS) {
      throw SuiteRequestError.make({ message: NO_DEFINITIONS });
    }
    throw error;
  }
};
