#!/usr/bin/env -S node --experimental-strip-types
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";
import { experimentCommand } from "../test.ts";
import { runTestResults } from "../test-results.ts";

if (existsSync(".env")) {
  loadEnvFile();
}

const token = process.env.OLIGARCHY_TOKEN;
if (token === undefined || token === "") {
  throw new Error("OLIGARCHY_TOKEN is not set");
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_ENCODING = "oligarchy";

// /start blocks until the ISO is fetched and QEMU boots; a first-time URL download can
// outlast fetch's 300s header timeout, which fetch does not let a caller raise per
// request. So /start goes through node:http (postStart) with this idle ceiling instead.
const START_TIMEOUT_MS = 45 * 60 * 1000;

const UnitInterval = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }, { message: "mouse: x and y must be in 0..1" }),
);

const client = Command.make("client").pipe(
  Command.withSharedFlags({
    agentId: Flag.string("agent-id").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.optional,
      Flag.withDescription("Calling agent's id"),
    ),
    serverUrl: Flag.string("server-url").pipe(
      Flag.withDefault(DEFAULT_SERVER_URL),
      Flag.withDescription("Proxy URL, used as given"),
    ),
  }),
  Command.withDescription("The client for the oligarchy proxy"),
);

function requireAgent(agentId: Option.Option<string>): Effect.Effect<string, CliError.UserError> {
  if (Option.isNone(agentId)) {
    return Effect.fail(fail(new Error("Missing required flag: --agent-id")));
  }
  return Effect.succeed(agentId.value);
}

function fail(cause: unknown): CliError.UserError {
  const e = cause as Error;
  let text = errorMessage(cause);
  if (e.stack !== undefined) {
    text += `\n${e.stack}`;
  }
  if (e.cause instanceof Error && e.cause.stack !== undefined && e.cause.stack !== e.stack) {
    text += `\n${e.cause.stack}`;
  }
  return new CliError.UserError({ cause, userMessage: text });
}

const start = Command.make(
  "start",
  {
    iso: Flag.string("iso").pipe(Flag.withDefault(DEFAULT_ISO)),
    disk: Flag.string("disk").pipe(Flag.optional),
  },
  Effect.fn(function* ({ iso, disk }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    let image = iso;
    if (!image.startsWith("http://") && !image.startsWith("https://")) {
      image = resolve(image);
      yield* Effect.tryPromise({
        try: () => stat(image),
        catch: (err) => fail(new Error(`iso: ${errorMessage(err)}`)),
      });
    }
    const out = JSON.parse(
      yield* Effect.tryPromise({
        try: () =>
          postStart(serverUrl, {
            iso: image,
            // An undefined disk is left out of the JSON, so the server creates one.
            disk: Option.isNone(disk) ? undefined : resolve(disk.value),
            agent,
          }),
        catch: fail,
      }),
    ) as QemuStartResult;
    yield* Console.log(out.id);
  }),
);

const getImage = Command.make(
  "get-image",
  {
    output: Flag.string("output").pipe(Flag.withAlias("o"), Flag.optional),
    id: Argument.string("id"),
  },
  Effect.fn(function* ({ id, output }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(`${serverUrl}/image?id=${encodeURIComponent(id)}&agent=${encodeURIComponent(agent)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      catch: fail,
    });
    if (res.status !== 200) {
      const message = yield* Effect.tryPromise({
        try: () => readAPIError(res),
        catch: fail,
      });
      return yield* Effect.fail(fail(new Error(message)));
    }
    const data = Buffer.from(
      yield* Effect.tryPromise({
        try: () => res.arrayBuffer(),
        catch: fail,
      }),
    );
    if (Option.isSome(output)) {
      yield* Effect.tryPromise({
        try: () => writeFile(output.value, data, { mode: 0o644 }),
        catch: fail,
      });
      return;
    }
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((done, failWrite) => {
          process.stdout.write(data, (err) => (err ? failWrite(err) : done()));
        }),
      catch: fail,
    });
  }),
);

const getSerial = Command.make(
  "get-serial",
  {
    output: Flag.string("output").pipe(Flag.withAlias("o"), Flag.optional),
    id: Argument.string("id"),
  },
  Effect.fn(function* ({ id, output }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(`${serverUrl}/serial?id=${encodeURIComponent(id)}&agent=${encodeURIComponent(agent)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      catch: fail,
    });
    if (res.status !== 200) {
      const message = yield* Effect.tryPromise({
        try: () => readAPIError(res),
        catch: fail,
      });
      return yield* Effect.fail(fail(new Error(message)));
    }
    const data = Buffer.from(
      yield* Effect.tryPromise({
        try: () => res.arrayBuffer(),
        catch: fail,
      }),
    );
    if (Option.isSome(output)) {
      yield* Effect.tryPromise({
        try: () => writeFile(output.value, data, { mode: 0o644 }),
        catch: fail,
      });
      return;
    }
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((done, failWrite) => {
          process.stdout.write(data, (err) => (err ? failWrite(err) : done()));
        }),
      catch: fail,
    });
  }),
);

const sendKeys = Command.make(
  "send-keys",
  {
    id: Argument.string("id"),
    keys: Argument.string("keys"),
    encoding: Argument.string("encoding").pipe(Argument.withDefault(DEFAULT_ENCODING)),
  },
  Effect.fn(function* ({ id, keys, encoding }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    yield* Effect.tryPromise({
      try: () => postJSON(serverUrl, "/send-keys", { id, keys, encoding, agent }),
      catch: fail,
    });
  }),
);

const sendMouse = Command.make(
  "send-mouse",
  {
    id: Argument.string("id"),
    x: Argument.float("x").pipe(Argument.withSchema(UnitInterval)),
    y: Argument.float("y").pipe(Argument.withSchema(UnitInterval)),
    button: Argument.choice("button", ["left", "middle", "right", "wheel-up", "wheel-down"]).pipe(Argument.optional),
    clicks: Argument.integer("clicks").pipe(
      Argument.withSchema(
        Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
      ),
      Argument.optional,
    ),
  },
  Effect.fn(function* ({ id, x, y, button, clicks }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    const body: { id: string; x: number; y: number; agent: string; button?: string; clicks?: number } = {
      id,
      x,
      y,
      agent,
    };
    if (Option.isSome(button)) {
      body.button = button.value;
    }
    if (Option.isSome(clicks)) {
      body.clicks = clicks.value;
    }
    yield* Effect.tryPromise({
      try: () => postJSON(serverUrl, "/send-mouse", body),
      catch: fail,
    });
  }),
);

const stop = Command.make(
  "stop",
  {
    id: Argument.string("id"),
    status: Argument.choice("status", ["succeeded", "failed", "aborted"]).pipe(Argument.optional),
    reason: Argument.string("reason").pipe(Argument.optional),
  },
  Effect.fn(function* ({ id, status, reason }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    const body: { id: string; agent: string; status?: string; reason?: string } = { id, agent };
    if (Option.isSome(status)) {
      body.status = status.value;
    }
    if (Option.isSome(reason)) {
      body.reason = reason.value;
    }
    yield* Effect.tryPromise({
      try: () => postJSON(serverUrl, "/stop", body),
      catch: fail,
    });
  }),
);

const testResults = Command.make(
  "test-results",
  {
    id: Flag.string("id").pipe(Flag.withDescription("Test result id")),
    status: Flag.choiceWithValue("status", [
      ["success", "passed"],
      ["failed", "failed"],
    ]).pipe(Flag.withDescription("Whether the test succeeded")),
    reason: Flag.string("reason").pipe(Flag.optional, Flag.withDescription("Why the test passed or failed")),
  },
  Effect.fn(function* ({ id, status, reason }) {
    const { agentId } = yield* client;
    const agent = yield* requireAgent(agentId);
    yield* Effect.tryPromise({
      try: () =>
        runTestResults({
          id,
          agentId: agent,
          status,
          reason: Option.isNone(reason) ? undefined : reason.value,
        }),
      catch: fail,
    });
  }),
);

const intentStart = Command.make(
  "start",
  {
    sessionId: Flag.string("session_id").pipe(Flag.withSchema(Schema.NonEmptyString)),
    testResultId: Flag.string("test_result_id").pipe(Flag.withSchema(Schema.NonEmptyString)),
    message: Flag.string("message").pipe(Flag.withSchema(Schema.NonEmptyString)),
  },
  Effect.fn(function* ({ sessionId, testResultId, message }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    yield* Effect.tryPromise({
      try: () =>
        postJSON(serverUrl, "/intent/start", {
          id: sessionId,
          agent,
          test_result_id: testResultId,
          message,
        }),
      catch: fail,
    });
  }),
);

const intentEnd = Command.make(
  "end",
  {
    sessionId: Flag.string("session_id").pipe(Flag.withSchema(Schema.NonEmptyString)),
  },
  Effect.fn(function* ({ sessionId }) {
    const { agentId, serverUrl } = yield* client;
    const agent = yield* requireAgent(agentId);
    yield* Effect.tryPromise({
      try: () => postJSON(serverUrl, "/intent/end", { id: sessionId, agent }),
      catch: fail,
    });
  }),
);

const intent = Command.make("intent").pipe(
  Command.withDescription("Start or end the session's one active intent"),
  Command.withSubcommands([intentStart, intentEnd]),
);

const app = client.pipe(
  Command.withSubcommands([
    experimentCommand,
    testResults,
    start,
    getImage,
    getSerial,
    sendKeys,
    sendMouse,
    stop,
    intent,
  ]),
);

async function postJSON(serverUrl: string, path: string, body: unknown): Promise<string> {
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(await readAPIError(res));
  }
  return res.text();
}

// /start alone can outlast fetch's fixed 300s header timeout, so it uses node:http,
// whose idle timeout is the only ceiling — the connection sits quiet while the server
// downloads the ISO and boots, then the reply arrives in one short burst.
function postStart(serverUrl: string, body: unknown): Promise<string> {
  const url = new URL(`${serverUrl}/start`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const payload = JSON.stringify(body);
  return new Promise<string>((resolve, reject) => {
    const req = send(
      url,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        // A reset mid-body emits res error but never end, so without this the promise
        // (and its timeout, gone with the destroyed socket) would hang forever.
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode!;
          if (status >= 200 && status < 300) {
            resolve(data);
          } else {
            reject(new Error(apiError(data)));
          }
        });
      },
    );
    req.setTimeout(START_TIMEOUT_MS, () => req.destroy(new Error("start: no response within timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

async function readAPIError(res: Response): Promise<string> {
  return apiError(await res.text());
}

function apiError(data: string): string {
  try {
    return (JSON.parse(data) as { error: string }).error;
  } catch {
    return data || "request failed";
  }
}

function errorMessage(err: unknown): string {
  const e = err as Error;
  // Node's fetch and Drizzle bury the useful detail in the cause.
  return e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message;
}

NodeRuntime.runMain(
  app.pipe(
    Command.run({ version: "0.0.0" }),
    Effect.provide(NodeServices.layer),
  ),
  { disableErrorReporting: true },
);
