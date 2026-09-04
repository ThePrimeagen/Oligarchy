#!/usr/bin/env -S node --experimental-strip-types
import { once } from "node:events";
import { createInterface } from "node:readline";
import { CliError } from "effect/unstable/cli";
import { followRun } from "./actions/follow.ts";
import { getImageRun } from "./actions/get-image.ts";
import { getSerialRun } from "./actions/get-serial.ts";
import { intentRun } from "./actions/intent.ts";
import { sendKeysRun } from "./actions/send-keys.ts";
import { sendMouseRun } from "./actions/send-mouse.ts";
import { startRun } from "./actions/start.ts";
import { statusRun } from "./actions/status.ts";
import { STOP_STATUSES, stopRun } from "./actions/stop.ts";
import { createSession } from "./client.ts";
import { parseSessionArgs } from "./parse-args.ts";

const HELP = `start [iso] [disk]                    boot a qemu session (default iso: omarchy.iso)
get-image                             show the guest display inline
get-serial                            print the guest serial console
send-keys <keys>                      type into the guest, e.g. send-keys hello<ENTER>
send-mouse <x> <y> [button] [clicks]  move, click, or scroll; x and y are 0..1 fractions
intent start <message>                declare what you are about to do
intent end                            close the open intent
stop [status] [reason]                stop the session; status is succeeded, failed, or aborted
follow <session-id>                   watch another session live: its actions down the left, its latest image on the right; ctrl-c detaches
status                                show agent, server, session, and intent
exit                                  stop the session and leave`;

const COMMANDS = ["start", "get-image", "get-serial", "send-keys", "send-mouse", "intent", "stop", "follow", "status", "help", "exit", "quit"];

function completer(line: string): [string[], string] {
  const intentArg = /^\s*intent\s+(\S*)$/.exec(line);
  if (intentArg !== null) {
    return [["start", "end"].filter((word) => word.startsWith(intentArg[1])), intentArg[1]];
  }
  const stopArg = /^\s*stop\s+(\S*)$/.exec(line);
  if (stopArg !== null) {
    return [STOP_STATUSES.filter((word) => word.startsWith(stopArg[1])), stopArg[1]];
  }
  const word = line.trimStart();
  if (/\s/.test(word)) {
    return [[], line];
  }
  return [COMMANDS.filter((command) => command.startsWith(word)), word];
}

let args;
try {
  args = await parseSessionArgs(process.argv.slice(2));
} catch (err) {
  // Effect already rendered parse failures with the usage.
  if (!CliError.isCliError(err)) {
    const e = err as Error;
    console.error(e.message);
    console.error(e);
  }
  process.exit(1);
}

const session = createSession(args.serverUrl);
let shuttingDown = false;

const rl = createInterface({ input: process.stdin, output: process.stdout, completer });
// While a follow holds the screen, Ctrl-C detaches from it; otherwise it leaves.
rl.on("SIGINT", () => {
  if (session.following !== undefined) {
    session.following.kill();
    return;
  }
  void shutdown();
});
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());

async function dispatch(line: string): Promise<void> {
  const command = line.split(/\s+/, 1)[0];
  const rest = line.slice(command.length).trim();
  switch (command) {
    case "start":
      await startRun(session, rest);
      break;
    case "get-image":
      await getImageRun(session);
      break;
    case "get-serial":
      await getSerialRun(session);
      break;
    case "send-keys":
      await sendKeysRun(session, rest);
      break;
    case "send-mouse":
      await sendMouseRun(session, rest);
      break;
    case "intent":
      await intentRun(session, rest);
      break;
    case "stop":
      await stopRun(session, rest);
      break;
    case "follow":
      await followRun(session, rest);
      break;
    case "status":
      statusRun(session);
      break;
    case "help":
      console.log(HELP);
      break;
    case "exit":
    case "quit":
      await shutdown();
      break;
    default:
      console.log(`unknown command: ${command}. tab lists commands; help explains them.`);
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  rl.close();
  // The follow child is in its own process group, so a hangup or SIGTERM here never reaches
  // it; its close is what hands the screen back, so wait for that before exiting.
  if (session.following !== undefined) {
    session.following.kill();
    await once(session.following, "close");
  }
  // A start killed mid-boot still boots on the proxy (/start is uninterruptible), so wait
  // for the id it returns and stop that, rather than leaving an unreachable session behind.
  const inflight = session.startInFlight;
  if (inflight !== undefined) {
    const result = await inflight;
    if (session.sessionId === undefined && result.code === 0) {
      session.sessionId = result.stdout.toString("utf8").trim();
    }
  }
  if (session.sessionId !== undefined) {
    console.log(`stopping session ${session.sessionId}`);
    await stopRun(session, "");
  }
  process.exit(0);
}

function promptText(): string {
  return session.sessionId === undefined ? "session> " : `session ${session.sessionId.slice(0, 8)}> `;
}

console.log(`server ${session.serverUrl}`);
console.log('tab lists commands, "help" explains them, "exit" stops the session and leaves');

rl.setPrompt(promptText());
rl.prompt();
for await (const line of rl) {
  const trimmed = line.trim();
  if (trimmed !== "") {
    try {
      await dispatch(trimmed);
    } catch (err) {
      const e = err as Error;
      console.error(e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message);
      console.error(e);
    }
  }
  if (shuttingDown) {
    break;
  }
  rl.setPrompt(promptText());
  rl.prompt();
}
await shutdown();
