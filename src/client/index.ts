#!/usr/bin/env -S node --experimental-strip-types
import { CliError } from "effect/unstable/cli";
import { getImageRun } from "./actions/get-image.ts";
import { getSerialRun } from "./actions/get-serial.ts";
import { intentRun } from "./actions/intent.ts";
import { sendKeysRun } from "./actions/send-keys.ts";
import { sendMouseRun } from "./actions/send-mouse.ts";
import { startRun } from "./actions/start.ts";
import { stopRun } from "./actions/stop.ts";

const USAGE = `usage: client <action> --agent-id <agent> [--server-url <url>] ...

actions:
  start [--iso <path|url>] [--disk <path>]
  get-image --session-id <id> [-o <file>]
  get-serial --session-id <id> [-o <file>]
  send-keys --session-id <id> --keys <keys> [--encoding <encoding>]
  send-mouse --session-id <id> --x <0..1> --y <0..1> [--button <button>] [--clicks <n>]
  intent start --session-id <id> --test-result-id <id> --message <text>
  intent end --session-id <id>
  stop --session-id <id> [--status succeeded|failed|aborted] [--reason <text>]

Every value is a flag; there are no positional arguments.
client <action> --help prints that action's flags.`;

const [action, ...argv] = process.argv.slice(2);

try {
  switch (action) {
    case "start":
      await startRun(argv);
      break;
    case "get-image":
      await getImageRun(argv);
      break;
    case "get-serial":
      await getSerialRun(argv);
      break;
    case "send-keys":
      await sendKeysRun(argv);
      break;
    case "send-mouse":
      await sendMouseRun(argv);
      break;
    case "intent":
      await intentRun(argv);
      break;
    case "stop":
      await stopRun(argv);
      break;
    case "--help":
    case "-h":
      console.log(USAGE);
      break;
    default:
      console.error(action === undefined ? USAGE : `client: unknown action: ${action}\n\n${USAGE}`);
      process.exit(1);
  }
} catch (err) {
  // Effect already rendered parse failures with the action's help.
  if (!CliError.isCliError(err)) {
    const e = err as Error;
    // Node's fetch buries the useful detail in the cause: one headline that says both,
    // then the error as Node renders it — stack, cause chain, and every property.
    console.error(e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message);
    console.error(e);
  }
  process.exit(1);
}
