import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { type Cause, Deferred, Effect, Exit, Fiber, Layer, Path, Queue, Stream } from "effect";
import { TestConsole } from "effect/testing";
import type { ChildProcess } from "effect/unstable/process";
import * as FollowView from "../../src/session/follow-view.ts";
import * as Grammar from "../../src/session/grammar.ts";
import * as Image from "../../src/session/image.ts";
import * as Repl from "../../src/session/repl.ts";
import * as State from "../../src/session/state.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as FakeChildren from "../support/fake-children.ts";
import { fakeTty, type FakeTty } from "../support/fake-tty.ts";

const SERVER_URL = "http://127.0.0.1:42069";
const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";
const FOLLOWED_ID = "7a2d0000-0000-4000-8000-00000000f011";
const IMAGE_ID = "9c4f0000-0000-4000-8000-00000000b2d3";
const encoder = new TextEncoder();
const ESC = String.fromCharCode(27);

// A 2x2 8-bit RGB PNG: red, green / blue, white (deflate of the filtered rows, stored).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVR4nGP4z8DAwPCfgYGB4T8DAwMDAB1cBf6DrvMVAAAAAElFTkSuQmCC",
  "base64",
);

const consoleLines: Effect.Effect<ReadonlyArray<string>> = Effect.map(
  TestConsole.logLines,
  (lines) => lines.map(String),
);

const untilLogged = (text: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    for (let i = 0; i < 2_000; i++) {
      const lines = yield* consoleLines;
      if (lines.some((line) => line.includes(text))) {
        return lines;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`never logged: ${text}\n${(yield* consoleLines).join("\n")}`);
  });

const untilWritten = (tty: FakeTty, text: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let i = 0; i < 2_000; i++) {
      if (tty.written().includes(text)) {
        return undefined;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`never written: ${text}\n${tty.written()}`);
  });

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 50; i++) {
    yield* Effect.yieldNow;
  }
});

// The client's argv without the node flags and the entry: action first.
const clientArgs = (command: ChildProcess.StandardCommand): ReadonlyArray<string> =>
  command.args.slice(3);

const spawnedArgs = (h: Harness, index: number): ReadonlyArray<string> => {
  const child = h.spawner.spawned[index];
  if (child === undefined) {
    throw new Error(`no child ${String(index)} was spawned`);
  }
  return clientArgs(child.command);
};

type Script = (args: ReadonlyArray<string>, index: number) => FakeChildren.Script;

const happyClient: Script = (args) => {
  switch (args[0]) {
    case "start":
      return { code: 0, stdout: `${SESSION_ID}\n` };
    case "get-image":
      return { code: 0, stdout: new Uint8Array(TINY_PNG) };
    case "get-serial":
      return { code: 0, stdout: "boot log\n" };
    default:
      return { code: 0 };
  }
};

type Harness = {
  readonly tty: FakeTty;
  readonly spawner: FakeChildren.FakeSpawner;
  readonly fiber: Fiber.Fiber<void>;
  readonly terminate: Effect.Effect<void>;
  readonly type: (line: string) => Effect.Effect<void>;
};

const harness = (
  script: Script,
  options: { readonly protocol?: Image.ImageProtocol; readonly isTTY?: boolean } = {},
): Effect.Effect<Harness> =>
  Effect.gen(function* () {
    const tty = fakeTty({ isTTY: options.isTTY ?? false, columns: 100, rows: 24 });
    const termination = yield* Deferred.make<void>();
    const spawner = FakeChildren.fakeSpawner((command, index) =>
      script(clientArgs(command), index),
    );
    const host = State.Host.of({
      execPath: "/opt/node/bin/node",
      imageProtocol: options.protocol ?? "ansi",
      input: tty.input,
      output: tty.output,
      termination: Deferred.await(termination),
    });
    const fiber = yield* Effect.forkChild(
      Repl.run(SERVER_URL).pipe(
        Effect.provideService(State.Host, host),
        Effect.provide(Layer.mergeAll(spawner.layer, Path.layer)),
      ),
      { startImmediately: true },
    );
    yield* untilWritten(tty, "session> ");
    const newline = options.isTTY === true ? "\r" : "\n";
    return {
      tty,
      spawner,
      fiber,
      terminate: Deferred.succeed(termination, undefined).pipe(Effect.asVoid),
      type: (line) =>
        Effect.sync(() => {
          tty.type(`${line}${newline}`);
        }),
    };
  });

const encodeLine = (event: Domain.FollowEvent): Uint8Array =>
  encoder.encode(Domain.encodeFollowLine(event));

describe("the command tour", () => {
  it.effect("drives one session through every command, printing today's lines in order", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient);
      expect(yield* consoleLines).toEqual([`server ${SERVER_URL}`, Grammar.HINT]);
      yield* h.type("start https://example.com/omarchy.iso");
      yield* untilLogged(`session ${SESSION_ID}`);
      const agent = spawnedArgs(h, 0);
      const agentId = agent[agent.indexOf("--agent-id") + 1] ?? "";
      expect(agentId).toMatch(/^session-[0-9a-f-]{36}$/);
      expect(yield* consoleLines).toEqual([
        `server ${SERVER_URL}`,
        Grammar.HINT,
        "booting; a first-time iso download can take a while...",
        `agent   ${agentId}`,
        `session ${SESSION_ID}`,
      ]);
      yield* h.type("intent start wait for the boot menu");
      yield* untilLogged("ok");
      yield* h.type("status");
      yield* untilLogged("intent  open");
      yield* h.type("send-keys hello world<ENTER>");
      yield* h.type("send-mouse 0.5 0.25 left 2");
      yield* h.type("send-mouse 0 1");
      yield* h.type("get-image");
      yield* untilWritten(h.tty, "▀");
      yield* h.type("get-serial");
      yield* untilLogged("boot log");
      yield* h.type("intent end");
      yield* h.type("stop succeeded all good");
      yield* untilLogged(`stopped ${SESSION_ID}`);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);

      expect(h.spawner.spawned.map((child) => clientArgs(child.command))).toEqual([
        [
          "start",
          "--iso",
          "https://example.com/omarchy.iso",
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "intent",
          "start",
          "--session-id",
          SESSION_ID,
          "--test-result-id",
          "manual",
          "--message",
          "wait for the boot menu",
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "send-keys",
          "--session-id",
          SESSION_ID,
          "--keys",
          "hello world<ENTER>",
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "send-mouse",
          "--session-id",
          SESSION_ID,
          "--x",
          "0.5",
          "--y",
          "0.25",
          "--button",
          "left",
          "--clicks",
          "2",
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "send-mouse",
          "--session-id",
          SESSION_ID,
          "--x",
          "0",
          "--y",
          "1",
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "get-image",
          "--session-id",
          SESSION_ID,
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "get-serial",
          "--session-id",
          SESSION_ID,
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "intent",
          "end",
          "--session-id",
          SESSION_ID,
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
        [
          "stop",
          "--session-id",
          SESSION_ID,
          "--status",
          "succeeded",
          "--reason",
          "all good",
          "--agent-id",
          agentId,
          "--server-url",
          SERVER_URL,
        ],
      ]);
      for (const child of h.spawner.spawned) {
        expect(child.command.options.detached).toBe(true);
        expect(child.command.options.extendEnv).toBe(true);
      }
      const lines = yield* consoleLines;
      expect(lines).toEqual([
        `server ${SERVER_URL}`,
        Grammar.HINT,
        "booting; a first-time iso download can take a while...",
        `agent   ${agentId}`,
        `session ${SESSION_ID}`,
        "ok",
        `agent   ${agentId}`,
        `server  ${SERVER_URL}`,
        `session ${SESSION_ID}`,
        "intent  open",
        "ok",
        "ok",
        "ok",
        "boot log\n",
        "ok",
        `stopped ${SESSION_ID}`,
      ]);
      expect(lines.includes(`stopping session ${SESSION_ID}`)).toBe(false);
      // The prompt names the session while one is running and drops it once stopped.
      expect(h.tty.written()).toContain(`session ${SESSION_ID.slice(0, 8)}> `);
      expect(h.tty.written().endsWith("session> ")).toBe(true);
    }),
  );

  it.effect("help prints the grammar, status reports no session and no intent", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient);
      yield* h.type("help");
      yield* untilLogged(Grammar.HELP);
      yield* h.type("status");
      yield* untilLogged("intent  none");
      const lines = yield* consoleLines;
      expect(lines.slice(2, 3)).toEqual([Grammar.HELP]);
      expect(lines[3]).toMatch(/^agent   session-[0-9a-f-]{36}$/);
      expect(lines.slice(4)).toEqual([`server  ${SERVER_URL}`, "session none", "intent  none"]);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
      expect(h.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("mints a fresh agent id per start and refuses a second start while one runs", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient);
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID} is already running. stop it first.`);
      yield* h.type("stop");
      yield* untilLogged(`stopped ${SESSION_ID}`);
      yield* h.type("start omarchy.iso disk.qcow2");
      yield* untilLogged("stop it first.");
      for (let i = 0; i < 2_000; i++) {
        const lines = yield* consoleLines;
        if (lines.filter((line) => line === `session ${SESSION_ID}`).length === 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      const starts = h.spawner.spawned
        .map((child) => clientArgs(child.command))
        .filter((args) => args[0] === "start");
      expect(starts).toHaveLength(2);
      const agentOf = (args: ReadonlyArray<string>) => args[args.indexOf("--agent-id") + 1];
      expect(agentOf(starts[0] ?? [])).toMatch(/^session-/);
      expect(agentOf(starts[1] ?? [])).toMatch(/^session-/);
      expect(agentOf(starts[0] ?? [])).not.toBe(agentOf(starts[1] ?? []));
      expect(starts[1]?.slice(0, 5)).toEqual([
        "start",
        "--iso",
        "omarchy.iso",
        "--disk",
        "disk.qcow2",
      ]);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );

  it.effect("an empty serial prints (serial is empty) and an empty line is ignored", () =>
    Effect.gen(function* () {
      const h = yield* harness((args) =>
        args[0] === "start" ? { code: 0, stdout: SESSION_ID } : { code: 0, stdout: "" },
      );
      yield* h.type("");
      yield* h.type("   ");
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* h.type("get-serial");
      yield* untilLogged("(serial is empty)");
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
      expect((yield* consoleLines).filter((line) => line.startsWith("unknown"))).toEqual([]);
    }),
  );
});

describe("refusals and failures", () => {
  it.effect(
    "commands before start, unknown commands and a malformed send-mouse spawn nothing",
    () =>
      Effect.gen(function* () {
        const h = yield* harness(happyClient);
        yield* h.type("send-keys hello");
        yield* h.type("send-mouse 0.5");
        yield* h.type("intent start now");
        yield* h.type("intent end");
        yield* h.type("stop");
        yield* h.type("get-image");
        yield* h.type("get-serial");
        yield* h.type("reboot");
        yield* h.type("intent pause");
        yield* h.type("follow");
        yield* untilLogged("usage: follow <session-id>");
        expect((yield* consoleLines).slice(2)).toEqual([
          "no session. run start first.",
          "no session. run start first.",
          "no session. run start first.",
          "no session. run start first.",
          "no session. run start first.",
          "no session. run start first.",
          "no session. run start first.",
          "unknown command: reboot. tab lists commands; help explains them.",
          "usage: intent start <message> | intent end",
          "usage: follow <session-id>",
        ]);
        yield* h.type("start https://example.com/omarchy.iso");
        yield* untilLogged(`session ${SESSION_ID}`);
        yield* h.type("send-mouse 0.5");
        yield* h.type("send-keys");
        yield* h.type("intent start");
        yield* h.type("intent end now");
        yield* h.type("stop done");
        yield* h.type("start a b c");
        yield* untilLogged("stop it first.");
        expect((yield* consoleLines).slice(-6)).toEqual([
          "usage: send-mouse <x> <y> [button] [clicks]",
          "usage: send-keys <keys>",
          "usage: intent start <message>",
          "usage: intent end",
          "usage: stop [succeeded|failed|aborted] [reason]",
          `session ${SESSION_ID} is already running. stop it first.`,
        ]);
        yield* h.type("stop");
        yield* h.type("exit");
        yield* Fiber.join(h.fiber);
        expect(h.spawner.spawned.map((child) => clientArgs(child.command)[0])).toEqual([
          "start",
          "stop",
        ]);
      }),
  );

  it.effect("a failing child prints its stderr and keeps the session", () =>
    Effect.gen(function* () {
      const h = yield* harness((args) =>
        args[0] === "intent" && args.includes("second")
          ? {
              code: 1,
              stderr:
                "Cannot start one intent when one's already running. Please end your previous intent.\nProxyRefusal: ...\n",
            }
          : happyClient(args, 0),
      );
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* h.type("intent start first");
      yield* untilLogged("ok");
      yield* h.type("intent start second");
      yield* untilLogged("Cannot start one intent");
      yield* h.type("status");
      yield* untilLogged("intent  open");
      const lines = yield* consoleLines;
      expect(lines).toContain(
        "Cannot start one intent when one's already running. Please end your previous intent.\nProxyRefusal: ...",
      );
      expect(lines.at(-2)).toBe(`session ${SESSION_ID}`);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
      expect(
        h.spawner.spawned.filter((child) => clientArgs(child.command)[0] === "intent"),
      ).toHaveLength(2);
    }),
  );

  it.effect("a failing stop clears the session anyway", () =>
    Effect.gen(function* () {
      const h = yield* harness((args) =>
        args[0] === "stop" ? { code: 1, stderr: 'unknown session "gone"' } : happyClient(args, 0),
      );
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* h.type("intent start hello");
      yield* untilLogged("ok");
      yield* h.type("stop");
      yield* untilLogged('unknown session "gone"');
      yield* h.type("status");
      yield* untilLogged("intent  none");
      expect((yield* consoleLines).slice(-5, -2)).toEqual([
        'unknown session "gone"',
        expect.stringMatching(/^agent   session-/),
        `server  ${SERVER_URL}`,
      ]);
      expect((yield* consoleLines).at(-2)).toBe("session none");
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
      expect((yield* consoleLines).includes("stopping session")).toBe(false);
    }),
  );

  it.effect("a failing get-image prints the stderr instead of an image", () =>
    Effect.gen(function* () {
      const h = yield* harness((args) =>
        args[0] === "get-image"
          ? { code: 1, stderr: "GET /image failed: boom" }
          : happyClient(args, 0),
      );
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* h.type("get-image");
      yield* untilLogged("GET /image failed: boom");
      expect(h.tty.written()).not.toContain("▀");
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );
});

describe("leaving", () => {
  it.effect("exit stops the running session and returns", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient);
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
      expect((yield* consoleLines).slice(-2)).toEqual([
        `stopping session ${SESSION_ID}`,
        `stopped ${SESSION_ID}`,
      ]);
      const stop = spawnedArgs(h, 1);
      expect(stop.slice(0, 3)).toEqual(["stop", "--session-id", SESSION_ID]);
      expect(stop).not.toContain("--status");
    }),
  );

  it.effect("quit stops the session too", () =>
    Effect.gen(function* () {
      const quit = yield* harness(happyClient);
      yield* quit.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      yield* quit.type("quit");
      yield* Fiber.join(quit.fiber);
      expect(quit.spawner.spawned.map((child) => clientArgs(child.command)[0])).toEqual([
        "start",
        "stop",
      ]);
    }),
  );

  it.effect("a closed stdin stops the session too", () =>
    Effect.gen(function* () {
      const eof = yield* harness(happyClient);
      yield* eof.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      eof.tty.end();
      yield* Fiber.join(eof.fiber);
      expect((yield* consoleLines).slice(-2)).toEqual([
        `stopping session ${SESSION_ID}`,
        `stopped ${SESSION_ID}`,
      ]);
    }),
  );

  it.effect("stdin closing without a session just returns, spawning nothing", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient);
      h.tty.end();
      yield* Fiber.join(h.fiber);
      expect(h.spawner.spawned).toEqual([]);
      expect(yield* consoleLines).toEqual([`server ${SERVER_URL}`, Grammar.HINT]);
    }),
  );

  it.effect("SIGTERM shuts down, awaits an in-flight start and adopts its id", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const h = yield* harness((args) =>
        args[0] === "start"
          ? {
              code: 0,
              stdout: Stream.fromEffect(Deferred.await(gate)).pipe(
                Stream.map(() => encoder.encode(`${SESSION_ID}\n`)),
              ),
            }
          : { code: 0 },
      );
      yield* h.type("start");
      yield* untilLogged("booting;");
      yield* h.terminate;
      yield* settle;
      expect(h.fiber.pollUnsafe()).toBeUndefined();
      expect(h.spawner.spawned).toHaveLength(1);
      expect(h.spawner.spawned[0]?.killed()).toBe(false);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(h.fiber);
      expect((yield* consoleLines).slice(-2)).toEqual([
        `stopping session ${SESSION_ID}`,
        `stopped ${SESSION_ID}`,
      ]);
      expect(spawnedArgs(h, 1).slice(0, 3)).toEqual(["stop", "--session-id", SESSION_ID]);
    }),
  );

  it.effect("SIGTERM without a session returns at once", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient);
      yield* h.terminate;
      yield* Fiber.join(h.fiber);
      expect(h.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("Ctrl-C without a follow shuts down like exit", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient, { isTTY: true });
      yield* h.type("start");
      yield* untilLogged(`session ${SESSION_ID}`);
      h.tty.type("\x03");
      yield* Fiber.join(h.fiber);
      expect((yield* consoleLines).slice(-2)).toEqual([
        `stopping session ${SESSION_ID}`,
        `stopped ${SESSION_ID}`,
      ]);
    }),
  );
});

describe("follow", () => {
  const followScript =
    (stdout: Stream.Stream<Uint8Array>, stderr = "", code = 0): Script =>
    (args) =>
      args[0] === "follow" ? { code, stdout, stderr } : happyClient(args, 0);

  it.effect("refuses without the kitty protocol and spawns nothing", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient, { protocol: "iterm" });
      yield* h.type(`follow ${FOLLOWED_ID}`);
      yield* untilLogged("follow needs the kitty graphics protocol (ghostty or kitty)");
      expect(h.spawner.spawned).toEqual([]);
      expect(h.tty.written()).not.toContain(FollowView.ENTER_SCREEN);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );

  it.effect("refuses a missing or extra id before the protocol check", () =>
    Effect.gen(function* () {
      const h = yield* harness(happyClient, { protocol: "ansi" });
      yield* h.type("follow");
      yield* h.type(`follow ${FOLLOWED_ID} extra`);
      yield* untilLogged("usage: follow <session-id>");
      yield* settle;
      expect(
        (yield* consoleLines).filter((line) => line === "usage: follow <session-id>"),
      ).toHaveLength(2);
      expect((yield* consoleLines).some((line) => line.includes("kitty"))).toBe(false);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );

  it.effect("draws the view, places the image and hands the REPL back when the session ends", () =>
    Effect.gen(function* () {
      const events: ReadonlyArray<Domain.FollowEvent> = [
        { type: "session", status: "pending" },
        { type: "session", status: "running" },
        { type: "intent", state: "started", message: "wait for the boot menu" },
        { type: "action", id: 1, name: "send-keys", state: "running" },
        { type: "action", id: 1, state: "completed" },
        { type: "action", id: 2, name: "get-image", state: "running" },
        { type: "image", id: IMAGE_ID, png: TINY_PNG.toString("base64") },
        { type: "action", id: 2, state: "completed" },
        { type: "action", id: 3, name: "send-mouse", state: "running" },
        { type: "action", id: 3, state: "failed" },
        { type: "intent", state: "completed" },
        { type: "action", id: 4, name: "get-serial", state: "running" },
        { type: "action", id: 4, state: "completed" },
        { type: "session", status: "succeeded" },
      ];
      const h = yield* harness(followScript(Stream.fromIterable(events.map(encodeLine))), {
        protocol: "kitty",
      });
      yield* h.type(`follow ${FOLLOWED_ID}`);
      yield* untilLogged(`session ${FOLLOWED_ID} succeeded`);
      yield* h.type("status");
      yield* untilLogged("session none");
      const out = h.tty.written();
      const on = out.indexOf(FollowView.ENTER_SCREEN);
      const off = out.indexOf(FollowView.LEAVE_SCREEN);
      expect(on !== -1 && off !== -1 && on < off).toBe(true);
      const view = out.slice(on, off);
      expect(view).toContain("following 7a2d0000");
      expect(view).toContain(`${ESC}[32m✓ wait for the boot menu`);
      expect(view).toContain(`${ESC}[32m✓ send-keys`);
      expect(view).toContain(`${ESC}[31m✗ send-mouse`);
      expect(view).toMatch(new RegExp(`${ESC}\\[\\d+;2H  ${ESC}\\[32m✓ send-keys`));
      expect(view).toMatch(new RegExp(`${ESC}\\[\\d+;2H${ESC}\\[32m✓ get-serial`));
      expect(view).toContain(`${ESC}[2;42H${ESC}_Ga=T`);
      expect(view).toContain("\x1b_Ga=d,d=I,i=1,q=2\x1b\\");
      expect(view).toContain(TINY_PNG.toString("base64"));
      expect(out.slice(off - 40, off)).toContain(Image.clearImages);
      expect(view).not.toMatch(/\n/);
      expect(spawnedArgs(h, 0).slice(0, 3)).toEqual(["follow", "--session-id", FOLLOWED_ID]);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
      expect(h.spawner.spawned).toHaveLength(1);
    }),
  );

  it.effect("a stream that ends while running was dropped by the proxy", () =>
    Effect.gen(function* () {
      const h = yield* harness(
        followScript(Stream.make(encodeLine({ type: "session", status: "running" }))),
        { protocol: "kitty" },
      );
      yield* h.type(`follow ${FOLLOWED_ID}`);
      yield* untilLogged(`dropped from ${FOLLOWED_ID}: this follower fell behind`);
      expect(h.tty.written()).toContain(FollowView.LEAVE_SCREEN);
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );

  it.effect("a refused follow prints the client's stderr and never takes the screen", () =>
    Effect.gen(function* () {
      const h = yield* harness(
        followScript(
          Stream.empty,
          `session "${FOLLOWED_ID}" has already completed (succeeded)\n`,
          1,
        ),
        { protocol: "kitty" },
      );
      yield* h.type(`follow ${FOLLOWED_ID}`);
      yield* untilLogged(`session "${FOLLOWED_ID}" has already completed (succeeded)`);
      expect(h.tty.written()).not.toContain(FollowView.ENTER_SCREEN);
      yield* h.type("status");
      yield* untilLogged("session none");
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );

  it.effect("Ctrl-C while following kills the child, restores the screen and prints detached", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      const h = yield* harness(followScript(Stream.fromQueue(queue)), {
        protocol: "kitty",
        isTTY: true,
      });
      yield* h.type(`follow ${FOLLOWED_ID}`);
      yield* Queue.offer(queue, encodeLine({ type: "session", status: "running" }));
      yield* Queue.offer(
        queue,
        encodeLine({ type: "intent", state: "started", message: "still going" }),
      );
      yield* untilWritten(h.tty, "still going");
      h.tty.type("\x03");
      yield* untilLogged(`detached from ${FOLLOWED_ID}`);
      expect(h.spawner.spawned[0]?.killed()).toBe(true);
      expect(h.tty.written()).toContain("\x1b[?25h\x1b[?1049l");
      expect(h.fiber.pollUnsafe()).toBeUndefined();
      yield* h.type("exit");
      yield* Fiber.join(h.fiber);
    }),
  );

  it.effect("SIGTERM while following restores the screen before leaving", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      const h = yield* harness(followScript(Stream.fromQueue(queue)), { protocol: "kitty" });
      yield* h.type(`follow ${FOLLOWED_ID}`);
      yield* Queue.offer(queue, encodeLine({ type: "session", status: "running" }));
      yield* untilWritten(h.tty, FollowView.ENTER_SCREEN);
      yield* h.terminate;
      const exit = yield* Fiber.await(h.fiber);
      expect(Exit.isSuccess(exit)).toBe(true);
      const out = h.tty.written();
      expect(out).toContain("\x1b[?25h\x1b[?1049l");
      expect(out.indexOf(FollowView.ENTER_SCREEN)).toBeLessThan(
        out.indexOf(FollowView.LEAVE_SCREEN),
      );
      expect(h.spawner.spawned[0]?.killed()).toBe(true);
    }),
  );
});
