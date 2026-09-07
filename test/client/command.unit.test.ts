import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Layer, Path, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import { CliError, Command } from "effect/unstable/cli";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ClientCommand from "../../src/client/command.ts";
import * as Api from "../../src/shared/api.ts";
import * as Support from "../support/config.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as Stdio from "../support/stdio.ts";

const SERVER = "http://127.0.0.1:42069";
const TOKEN = "test-token";
const SESSION = "session-1";
const AGENT = "agent-1";
const ID = "11111111-1111-4111-8111-111111111111";

const shared = ["--agent-id", AGENT, "--server-url", SERVER];

const TerminalStub = Layer.succeed(Terminal.Terminal)(
  Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: Effect.die("unexpected Terminal.readInput"),
    readLine: Effect.die("unexpected Terminal.readLine"),
    display: () => Effect.die("unexpected Terminal.display"),
  }),
);

const SpawnerStub = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
  ChildProcessSpawner.make(() => Effect.die("unexpected ChildProcessSpawner.spawn")),
);

type Options = {
  readonly env?: Record<string, string>;
  readonly http?: Layer.Layer<HttpClient.HttpClient>;
  readonly stdio?: Stdio.Captured;
};

const run = (args: ReadonlyArray<string>, options: Options = {}) =>
  Command.runWith(ClientCommand.makeClientCommand(), { version: Api.VERSION })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        Support.withEnv(options.env ?? { OLIGARCHY_TOKEN: TOKEN }),
        options.http ?? FakeHttp.die,
        (options.stdio ?? Stdio.capture()).layer,
        NodeFileSystem.layer,
        NodePath.layer,
        TerminalStub,
        SpawnerStub,
      ),
    ),
  );

const ok = () => FakeHttp.json({ ok: "true" });

const parsed = (body: string): unknown => JSON.parse(body);

const showHelp = (error: unknown): CliError.ShowHelp => {
  if (CliError.isCliError(error) && error._tag === "ShowHelp") {
    return error;
  }
  throw new Error(`expected ShowHelp, got ${String(error)}`);
};

describe("client requests", () => {
  it.effect("send-keys posts the key string with the agent and the default encoding", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      yield* run(["send-keys", ...shared, "--session-id", SESSION, "--keys", "hello"], {
        http: recorder.layer,
      });
      expect(recorder.requests).toHaveLength(1);
      expect(recorder.requests[0]?.method).toBe("POST");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/send-keys`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(parsed(recorder.requests[0]?.body ?? "")).toEqual({
        id: SESSION,
        keys: "hello",
        encoding: "oligarchy",
        agent: AGENT,
      });
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );

  it.effect("send-keys sends --encoding as given and accepts --flag=value", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      yield* run(
        [
          "send-keys",
          `--agent-id=${AGENT}`,
          `--server-url=${SERVER}`,
          `--session-id=${SESSION}`,
          "--keys=<ENTER>",
          "--encoding=raw",
        ],
        { http: recorder.layer },
      );
      expect(parsed(recorder.requests[0]?.body ?? "")).toEqual({
        id: SESSION,
        keys: "<ENTER>",
        encoding: "raw",
        agent: AGENT,
      });
    }),
  );

  it.effect("start posts a url iso and the agent, omits the disk, and prints only the id", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ id: ID }));
      yield* run(["start", ...shared, "--iso", "https://example.com/omarchy.iso"], {
        http: recorder.layer,
      });
      expect(recorder.requests[0]?.method).toBe("POST");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/start`);
      expect(parsed(recorder.requests[0]?.body ?? "")).toEqual({
        iso: "https://example.com/omarchy.iso",
        agent: AGENT,
      });
      expect(yield* TestConsole.logLines).toEqual([ID]);
    }),
  );

  it.effect("start absolutises a local iso and disk before posting", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const iso = path.join(dir, "omarchy.iso");
      yield* fs.writeFileString(iso, "iso");
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ id: ID }));
      yield* run(["start", ...shared, "--iso", iso, "--disk", "relative/disk.qcow2"], {
        http: recorder.layer,
      });
      expect(parsed(recorder.requests[0]?.body ?? "")).toEqual({
        iso,
        disk: path.resolve("relative/disk.qcow2"),
        agent: AGENT,
      });
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect(
    "send-mouse posts point, button and clicks, and omits button and clicks when absent",
    () =>
      Effect.gen(function* () {
        const recorder = FakeHttp.recordRequests(ok);
        const base = ["send-mouse", ...shared, "--session-id", SESSION];
        yield* run([...base, "--x", "0.5", "--y", "0.25", "--button", "left", "--clicks", "2"], {
          http: recorder.layer,
        });
        yield* run([...base, "--x", "0", "--y", "1"], { http: recorder.layer });
        expect(recorder.requests[0]?.url).toBe(`${SERVER}/send-mouse`);
        expect(parsed(recorder.requests[0]?.body ?? "")).toEqual({
          id: SESSION,
          x: 0.5,
          y: 0.25,
          button: "left",
          clicks: 2,
          agent: AGENT,
        });
        expect(parsed(recorder.requests[1]?.body ?? "")).toEqual({
          id: SESSION,
          x: 0,
          y: 1,
          agent: AGENT,
        });
      }),
  );

  it.effect("intent start and intent end post kebab-case flags as the wire's snake_case", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      yield* run(
        [
          "intent",
          "start",
          ...shared,
          "--session-id",
          SESSION,
          "--test-result-id",
          "result-1",
          "--message",
          "wait for the boot menu",
        ],
        { http: recorder.layer },
      );
      yield* run(["intent", "end", ...shared, "--session-id", SESSION], { http: recorder.layer });
      expect(recorder.requests.map((request) => [request.url, parsed(request.body)])).toEqual([
        [
          `${SERVER}/intent/start`,
          {
            id: SESSION,
            agent: AGENT,
            test_result_id: "result-1",
            message: "wait for the boot menu",
          },
        ],
        [`${SERVER}/intent/end`, { id: SESSION, agent: AGENT }],
      ]);
    }),
  );

  it.effect("stop posts the verdict and reason, and a bare stop posts neither", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const base = ["stop", ...shared, "--session-id", SESSION];
      yield* run([...base, "--status", "failed", "--reason", "installer hung"], {
        http: recorder.layer,
      });
      yield* run(base, { http: recorder.layer });
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/stop`);
      expect(parsed(recorder.requests[0]?.body ?? "")).toEqual({
        id: SESSION,
        agent: AGENT,
        status: "failed",
        reason: "installer hung",
      });
      expect(parsed(recorder.requests[1]?.body ?? "")).toEqual({ id: SESSION, agent: AGENT });
    }),
  );

  it.effect("stop rejects a verdict outside succeeded|failed|aborted", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const error = yield* Effect.flip(
        run(["stop", ...shared, "--session-id", SESSION, "--status", "done"], {
          http: recorder.layer,
        }),
      );
      expect(showHelp(error).errors.length).toBeGreaterThan(0);
      expect(recorder.requests).toEqual([]);
    }),
  );
});

describe("client output", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const image = () =>
    new Response(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "x-image-url": "https://oligarchy.trm.sh/images/9c4f0000-0000-4000-8000-00000000b2d3",
      },
    });

  it.effect("get-image -o writes the bytes to the file with mode 0o644 and prints nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const output = path.join(dir, "shot.png");
      const recorder = FakeHttp.recordRequests(image);
      const stdio = Stdio.capture();
      yield* run(["get-image", ...shared, "--session-id", SESSION, "-o", output], {
        http: recorder.layer,
        stdio,
      });
      expect(recorder.requests[0]?.method).toBe("GET");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/image?id=${SESSION}&agent=${AGENT}`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect([...(yield* fs.readFile(output))]).toEqual([...png]);
      expect((yield* fs.stat(output)).mode & 0o777).toBe(0o644);
      expect(stdio.stdout).toEqual([]);
      expect(yield* TestConsole.logLines).toEqual([]);
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("get-image --output is the long form of -o", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const output = path.join(dir, "shot.png");
      yield* run(["get-image", ...shared, "--session-id", SESSION, "--output", output], {
        http: FakeHttp.respondWith(image),
      });
      expect([...(yield* fs.readFile(output))]).toEqual([...png]);
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("get-image without -o writes the raw bytes to stdout", () =>
    Effect.gen(function* () {
      const stdio = Stdio.capture();
      yield* run(["get-image", ...shared, "--session-id", SESSION], {
        http: FakeHttp.respondWith(image),
        stdio,
      });
      expect(stdio.stdout).toHaveLength(1);
      expect([...(stdio.stdout[0] ?? [])]).toEqual([...png]);
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );

  it.effect("get-serial writes the bytes to stdout without -o and to the file with -o", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const output = path.join(dir, "serial.log");
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response("boot log\n", { status: 200, headers: { "content-type": "text/plain" } }),
      );
      const stdio = Stdio.capture();
      yield* run(["get-serial", ...shared, "--session-id", SESSION], {
        http: recorder.layer,
        stdio,
      });
      expect(Stdio.text(stdio.stdout)).toBe("boot log\n");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/serial?id=${SESSION}&agent=${AGENT}`);
      yield* run(["get-serial", ...shared, "--session-id", SESSION, "-o", output], {
        http: recorder.layer,
      });
      expect(yield* fs.readFileString(output)).toBe("boot log\n");
      expect((yield* fs.stat(output)).mode & 0o777).toBe(0o644);
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("follow streams the proxy's bytes to stdout and ends with the stream", () =>
    Effect.gen(function* () {
      const lines = [
        '{"type":"session","status":"running"}\n',
        '{"type":"action","id":1,"name":"send-keys","state":"running"}\n',
        '{"type":"session","status":"succeeded"}\n',
      ];
      const encoder = new TextEncoder();
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of lines) {
                  controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "application/x-ndjson" } },
          ),
      );
      const stdio = Stdio.capture();
      yield* run(["follow", ...shared, "--session-id", SESSION], { http: recorder.layer, stdio });
      expect(Stdio.text(stdio.stdout)).toBe(lines.join(""));
      expect(recorder.requests[0]?.method).toBe("GET");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/follow?id=${SESSION}`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }),
  );

  it.effect("follow fails with the proxy's refusal and writes nothing", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: `session "${SESSION}" has already completed (succeeded)` }, 409),
      );
      const stdio = Stdio.capture();
      const error = yield* Effect.flip(
        run(["follow", ...shared, "--session-id", SESSION], { http: recorder.layer, stdio }),
      );
      expect(error).toMatchObject({
        _tag: "ProxyRefusal",
        status: 409,
        message: `session "${SESSION}" has already completed (succeeded)`,
      });
      expect(stdio.stdout).toEqual([]);
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/follow?id=${SESSION}`);
    }),
  );

  it.effect("a refused request surfaces as ProxyRefusal with the server's message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run(["send-keys", ...shared, "--session-id", SESSION, "--keys", "hello"], {
          http: FakeHttp.respondWith(() => FakeHttp.json({ error: "no session session-1" }, 404)),
        }),
      );
      expect(error).toMatchObject({
        _tag: "ProxyRefusal",
        status: 404,
        message: "no session session-1",
      });
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );
});

describe("client help", () => {
  const actions: ReadonlyArray<ReadonlyArray<string>> = [
    ["start"],
    ["get-image"],
    ["get-serial"],
    ["send-keys"],
    ["send-mouse"],
    ["intent", "start"],
    ["intent", "end"],
    ["stop"],
    ["follow"],
  ];

  // Effect's --help action prints and returns; a bare group fails ShowHelp without errors. Both
  // exit 0, and neither may touch the proxy.
  it.effect(
    "--help on the root and on every action prints help without errors and no request",
    () =>
      Effect.gen(function* () {
        for (const action of [[], ...actions]) {
          const exit = yield* Effect.exit(run([...action, "--help"]));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect(showHelp(error).errors).toEqual([]);
          }
        }
        const help = (yield* TestConsole.logLines).map(String).join("\n");
        expect(help).toContain("start");
        expect(help).toContain("--session-id");
        expect(help).toContain("--agent-id");
        expect(help).toContain("--server-url");
        expect(yield* TestConsole.errorLines).toEqual([]);
      }),
  );

  it.effect("a bare client prints help without errors", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run([]));
      expect(showHelp(error).errors).toEqual([]);
      expect((yield* TestConsole.logLines).map(String).join("\n")).toContain("follow");
    }),
  );

  it.effect("an unknown action is a usage error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run(["bogus", "--agent-id", AGENT]));
      expect(showHelp(error).errors.length).toBeGreaterThan(0);
    }),
  );

  it.effect("intent without a verb prints intent's help without errors", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run(["intent"]));
      expect(showHelp(error).errors).toEqual([]);
      expect(showHelp(error).commandPath).toEqual(["client", "intent"]);
    }),
  );
});

describe("client parse failures", () => {
  it.effect("a missing --agent-id is a usage error naming the flag", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run(["send-keys", "--session-id", SESSION, "--keys", "hello"]),
      );
      const help = showHelp(error);
      expect(help.errors.length).toBeGreaterThan(0);
      expect(help.errors.map((failure) => failure.message).join("\n")).toContain("--agent-id");
    }),
  );

  it.effect("an underscore flag is unrecognised", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run(["intent", "end", "--agent-id", AGENT, "--session_id", SESSION]),
      );
      expect(
        showHelp(error)
          .errors.map((failure) => failure.message)
          .join("\n"),
      ).toContain("--session_id");
    }),
  );

  it.effect("a positional argument is unexpected", () =>
    Effect.gen(function* () {
      const extra = yield* Effect.flip(
        run(["send-keys", ...shared, "--session-id", SESSION, "extra", "--keys", "hello"]),
      );
      expect(
        showHelp(extra)
          .errors.map((failure) => failure.message)
          .join("\n"),
      ).toContain("extra");
      const verdict = yield* Effect.flip(
        run(["stop", ...shared, "--session-id", SESSION, "failed"]),
      );
      expect(
        showHelp(verdict)
          .errors.map((failure) => failure.message)
          .join("\n"),
      ).toContain("failed");
    }),
  );

  it.effect("missing --session-id and --keys are usage errors", () =>
    Effect.gen(function* () {
      const noSession = yield* Effect.flip(run(["send-keys", ...shared, "--keys", "hello"]));
      expect(
        showHelp(noSession)
          .errors.map((failure) => failure.message)
          .join("\n"),
      ).toContain("--session-id");
      const noKeys = yield* Effect.flip(run(["send-keys", ...shared, "--session-id", SESSION]));
      expect(
        showHelp(noKeys)
          .errors.map((failure) => failure.message)
          .join("\n"),
      ).toContain("--keys");
    }),
  );

  it.effect("a send-mouse coordinate outside 0..1 is refused before any request", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const error = yield* Effect.flip(
        run(["send-mouse", ...shared, "--session-id", SESSION, "--x", "2", "--y", "0.5"], {
          http: recorder.layer,
        }),
      );
      expect(
        showHelp(error)
          .errors.map((failure) => failure.message)
          .join("\n"),
      ).toContain("send-mouse: --x and --y must be in 0..1");
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect("send-mouse --clicks outside 1..100 is refused before any request", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const error = yield* Effect.flip(
        run(
          [
            "send-mouse",
            ...shared,
            "--session-id",
            SESSION,
            "--x",
            "0.5",
            "--y",
            "0.5",
            "--button",
            "left",
            "--clicks",
            "101",
          ],
          { http: recorder.layer },
        ),
      );
      expect(showHelp(error).errors.length).toBeGreaterThan(0);
      expect(recorder.requests).toEqual([]);
    }),
  );
});

describe("client local checks", () => {
  it.effect("send-mouse --clicks without --button is a CommandError before any request", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const error = yield* Effect.flip(
        run(
          [
            "send-mouse",
            ...shared,
            "--session-id",
            SESSION,
            "--x",
            "0.5",
            "--y",
            "0.5",
            "--clicks",
            "2",
          ],
          { http: recorder.layer },
        ),
      );
      expect(error).toMatchObject({
        _tag: "CommandError",
        message: "send-mouse: --clicks needs --button",
      });
      expect(recorder.requests).toEqual([]);
    }),
  );

  // v1 printed Node's own message after `iso: `; the platform wrapper's `NotFound: FileSystem.stat`
  // preamble must not appear.
  it.effect(
    "start with a missing local iso is a CommandError with the ENOENT message before any request",
    () =>
      Effect.gen(function* () {
        const recorder = FakeHttp.recordRequests(ok);
        const error = yield* Effect.flip(
          run(["start", ...shared, "--iso", "missing.iso"], { http: recorder.layer }),
        );
        expect(error._tag).toBe("CommandError");
        expect(error.message).toMatch(
          /^iso: ENOENT: no such file or directory, stat '\/.*\/missing\.iso'$/,
        );
        expect(recorder.requests).toEqual([]);
      }),
  );

  it.effect("start defaults --iso to omarchy.iso in the working directory", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const error = yield* Effect.flip(run(["start", ...shared], { http: recorder.layer }));
      expect(error._tag).toBe("CommandError");
      expect(error.message).toMatch(
        /^iso: ENOENT: no such file or directory, stat '\/.*\/omarchy\.iso'$/,
      );
      expect(recorder.requests).toEqual([]);
    }),
  );

  it.effect("a missing OLIGARCHY_TOKEN fails before any request, even before the iso check", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const keys = yield* Effect.flip(
        run(["send-keys", ...shared, "--session-id", SESSION, "--keys", "hello"], {
          env: {},
          http: recorder.layer,
        }),
      );
      expect(keys).toMatchObject({
        _tag: "MissingVariable",
        message: "OLIGARCHY_TOKEN is not set",
      });
      const start = yield* Effect.flip(
        run(["start", ...shared, "--iso", "missing.iso"], {
          env: { OLIGARCHY_TOKEN: "" },
          http: recorder.layer,
        }),
      );
      expect(start).toMatchObject({ _tag: "MissingVariable", name: "OLIGARCHY_TOKEN" });
      expect(recorder.requests).toEqual([]);
    }),
  );
});

describe("client server url", () => {
  it.effect("takes SERVER_URL when --server-url is omitted", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      yield* run(["send-keys", "--agent-id", AGENT, "--session-id", SESSION, "--keys", "hello"], {
        env: { OLIGARCHY_TOKEN: TOKEN, SERVER_URL: "http://proxy.test:1234" },
        http: recorder.layer,
      });
      expect(recorder.requests[0]?.url).toBe("http://proxy.test:1234/send-keys");
    }),
  );

  it.effect("falls back to the default when SERVER_URL is empty", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      yield* run(["send-keys", "--agent-id", AGENT, "--session-id", SESSION, "--keys", "hello"], {
        env: { OLIGARCHY_TOKEN: TOKEN, SERVER_URL: "" },
        http: recorder.layer,
      });
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/send-keys`);
    }),
  );

  it.effect("the flag beats the environment", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      yield* run(["send-keys", ...shared, "--session-id", SESSION, "--keys", "hello"], {
        env: { OLIGARCHY_TOKEN: TOKEN, SERVER_URL: "http://proxy.test:1234" },
        http: recorder.layer,
      });
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/send-keys`);
    }),
  );
});
