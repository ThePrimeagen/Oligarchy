#!/usr/bin/env -S node --experimental-strip-types
import { CliError } from "effect/unstable/cli";
import { sessionRun } from "./actions/session.ts";
import { testResultsRun } from "./actions/test-results.ts";
import { testRun } from "./actions/test.ts";

const USAGE = `usage: ctrl <action> [--server-url <url>] ...

actions:
  test --list [--details] [--name <definition>]
  test new --iso <https-url> --version <version> [--name <definition>]
  test list
  test run --ticket <linear-ticket>
  test start --session-id <id> --test-result-id <id>
  test-results --agent-id <agent> --id <id> --status success|failed [--reason <text>]
  session list [--count <n>] [--active] [--json]
  session --session-id <id> --logs|--test-def|--test-results|--actions|--all

Every action reads DATABASE_URL; every action but test run takes --server-url (or SERVER_URL).
ctrl <action> --help prints that action's flags.`;

const [action, ...argv] = process.argv.slice(2);

try {
  switch (action) {
    case "test":
      await testRun(argv);
      break;
    case "test-results":
      await testResultsRun(argv);
      break;
    case "session":
      await sessionRun(argv);
      break;
    case "--help":
    case "-h":
      console.log(USAGE);
      break;
    default:
      console.error(action === undefined ? USAGE : `ctrl: unknown action: ${action}\n\n${USAGE}`);
      process.exit(1);
  }
} catch (err) {
  // Effect already rendered parse failures with the action's help.
  if (!CliError.isCliError(err)) {
    const e = err as Error;
    // Drizzle's message is the failed SQL and the Postgres reason lives on the cause: one
    // headline that says both, then the error as Node renders it — stack, cause chain,
    // and every property.
    console.error(e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message);
    console.error(e);
  }
  process.exit(1);
}
