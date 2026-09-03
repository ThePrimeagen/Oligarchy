import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Effect } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { closeDatabase, connectDatabase } from "./db/ops.ts";
import { testDefinitions } from "./db/schema.ts";

export async function listTestDefinitions(): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const db = connectDatabase();
  try {
    const rows = await db.select({ name: testDefinitions.name }).from(testDefinitions).orderBy(testDefinitions.name);
    for (const row of rows) {
      console.log(row.name);
    }
  } finally {
    await closeDatabase(db);
  }
}

function fail(cause: unknown): CliError.UserError {
  const e = cause as Error;
  let text = e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message;
  if (e.stack !== undefined) {
    text += `\n${e.stack}`;
  }
  if (e.cause instanceof Error && e.cause.stack !== undefined && e.cause.stack !== e.stack) {
    text += `\n${e.cause.stack}`;
  }
  return new CliError.UserError({ cause, userMessage: text });
}

export const testDefCommand = Command.make(
  "test-def",
  {
    list: Flag.boolean("list").pipe(
      Flag.withDefault(false),
      Flag.withDescription("List stored test definition names"),
    ),
  },
  Effect.fn(function* ({ list }) {
    if (!list) {
      return yield* Effect.fail(fail(new Error("test-def: --list is required")));
    }
    yield* Effect.tryPromise({
      try: () => listTestDefinitions(),
      catch: fail,
    });
  }),
);
