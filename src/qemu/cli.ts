#!/usr/bin/env -S node --experimental-strip-types
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";
import { experimentCommand } from "../experiment.ts";

const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_ENCODING = "oligarchy";

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
          postJSON(serverUrl, "/start", {
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
      try: () => fetch(`${serverUrl}/image?id=${encodeURIComponent(id)}&agent=${encodeURIComponent(agent)}`),
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
      try: () => fetch(`${serverUrl}/serial?id=${encodeURIComponent(id)}&agent=${encodeURIComponent(agent)}`),
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
      Argument.withSchema(Schema.Number.check(Schema.isGreaterThanOrEqualTo(1))),
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

const app = client.pipe(
  Command.withSubcommands([experimentCommand, start, getImage, getSerial, sendKeys, sendMouse, stop]),
);

async function postJSON(serverUrl: string, path: string, body: unknown): Promise<string> {
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(await readAPIError(res));
  }
  return res.text();
}

async function readAPIError(res: Response): Promise<string> {
  const data = await res.text();
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
