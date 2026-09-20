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

// POST /create-test-suite-run runs `./ctrl create test-suite-run`. The worker has no checkout, so
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
      ? Effect.die(new Error(`create test-suite-run: no prompt at ${path}`))
      : Effect.succeed(text);
  },
});

const commandMessage = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return undefined;
  }
  if (!("_tag" in error) || error._tag !== "CommandError") {
    return undefined;
  }
  return typeof error.message === "string" ? error.message : undefined;
};

// The command's JSON is its last log line. `Log` writes the line before it; both come through
// this console, and nothing else does.
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
  const printed = lines.at(-1);
  if (printed === undefined) {
    throw new Error("create test-suite-run printed no JSON");
  }
  return JSON.parse(printed);
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
      "create",
      "test-suite-run",
      "--iso",
      request.iso,
      "--version",
      request.version,
      "--server-url",
      request.serverUrl,
    ]);
  } catch (error) {
    const message = commandMessage(error);
    if (message !== undefined) {
      throw new SuiteRequestError(message);
    }
    throw error;
  }
};
