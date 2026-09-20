import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Console, Effect, Exit, FileSystem, Layer, ManagedRuntime } from "effect";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Command from "effect/unstable/cli/Command";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import clientMd from "../../client.md";
import ctrlLinearMd from "../../ctrl-linear.md";
import linearIssue from "../../prompts/linear-issue.html";
import * as CtrlCommand from "../ctrl/command.ts";
import * as Api from "../shared/api.ts";

// POST /create-test-suite-run runs `./ctrl test run testsuite`. The worker has no checkout, so
// the files that command reads — the ticket template and the two guides it embeds — are these
// strings, the same files wrangler loads as text.

const REQUIRED = "iso, version and serverUrl are required";

export class SuiteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuiteRequestError";
  }
}

type SuiteBody = {
  readonly iso: string;
  readonly version: string;
  readonly serverUrl: string;
};

type SuiteRunner = (
  connectionString: string,
  token: string,
  args: ReadonlyArray<string>,
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
    throw new SuiteRequestError(REQUIRED);
  }
  if (!withHost(iso, "https:")) {
    throw new SuiteRequestError("iso must be a valid https url");
  }
  if (!withHost(serverUrl, "http:") && !withHost(serverUrl, "https:")) {
    throw new SuiteRequestError("serverUrl must be a valid http or https url");
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

// What `Prompts` reads through. A path this command does not ask for dies: an empty stand-in
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

// The command prints one JSON object, then a finalizer may print a log line (a failed log insert
// does not fail the command). The answer is the last JSON object, not whatever landed last.
export const responseJson = (lines: ReadonlyArray<string>): unknown => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || !line.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  throw new Error("test run testsuite printed no JSON");
};

const commandMessage = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return undefined;
  }
  if (!("_tag" in error) || error._tag !== "CommandError") {
    return undefined;
  }
  return typeof error.message === "string" ? error.message : undefined;
};

// `Log` and the printed JSON both come through this console. A finalizer may add a line after.
const runCtrlCommand: SuiteRunner = async (connectionString, token, args) => {
  const lines: Array<string> = [];
  const recording: Console.Console = Object.assign(Object.create(console), {
    log: (...parts: ReadonlyArray<unknown>) => {
      lines.push(parts.map(String).join(" "));
    },
  });
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Layer.merge(NodeServices.layer, bundledPrompts),
      FetchHttpClient.layer,
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { DATABASE_URL: connectionString, LINEAR_API_TOKEN: token },
        }),
      ),
      Layer.succeed(Console.Console, recording),
    ),
  );
  let exit: Exit.Exit<void, unknown>;
  try {
    exit = await runtime.runPromiseExit(
      Command.runWith(CtrlCommand.makeCtrlCommand(), { version: Api.VERSION })(args),
    );
  } finally {
    await runtime.dispose();
  }
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    throw error instanceof Error ? error : new Error(String(error));
  }
  return responseJson(lines);
};

export const createTestSuiteRun = async (
  env: { readonly LINEAR_API_TOKEN: string },
  connectionString: string,
  body: unknown,
  run: SuiteRunner = runCtrlCommand,
): Promise<unknown> => {
  const request = readBody(body);
  try {
    return await run(connectionString, env.LINEAR_API_TOKEN, [
      "test",
      "run",
      "testsuite",
      "--iso",
      request.iso,
      "--version",
      request.version,
      "--server-url",
      request.serverUrl,
    ]);
  } catch (error) {
    if (commandMessage(error) === NO_DEFINITIONS) {
      throw new SuiteRequestError(NO_DEFINITIONS);
    }
    throw error;
  }
};
