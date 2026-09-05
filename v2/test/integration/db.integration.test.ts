import { expect } from "vitest";
import { it, layer } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { Cause, Context, Effect, Exit, Layer, Option, Redacted, Scope } from "effect";
import { TestConsole } from "effect/testing";
import * as Actions from "../../src/db/actions.ts";
import * as Client from "../../src/db/client.ts";
import * as Logs from "../../src/db/logs.ts";
import * as Migrate from "../../src/db/migrate.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Sessions from "../../src/db/sessions.ts";
import * as Tests from "../../src/db/tests.ts";
import * as Render from "../../src/observability/render.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Support from "../support/config.ts";
import * as Postgres from "../support/postgres.ts";

const uuid = (): string => crypto.randomUUID();

const SEEDED_SUCCEEDED = "11111111-1111-4111-8111-111111111111";
const SEEDED_RUNNING = "22222222-2222-4222-8222-222222222222";

Postgres.describeWithDatabase("database", () => {
  layer(Postgres.migratedLayer, { timeout: "60 seconds" })((scoped) => {
    scoped.effect("the migration program prints its line and is idempotent", () =>
      Effect.gen(function* () {
        yield* Migrate.program;
        yield* Migrate.program;
        const lines = yield* TestConsole.logLines;
        expect(lines).toEqual(["database migrations applied", "database migrations applied"]);
      }).pipe(Effect.provide(Support.withEnv({ DATABASE_URL: Postgres.getDbUrl() }))),
    );

    scoped.effect("the migration program fails DATABASE_URL is not set without a url", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Migrate.program);
        expect(error.message).toBe("DATABASE_URL is not set");
      }).pipe(Effect.provide(Support.withEnv({}))),
    );

    scoped.effect("SessionStore writes the documented columns and stamps one now()", () =>
      Effect.gen(function* () {
        const store = yield* Sessions.SessionStore;
        const database = yield* Client.Database;
        const id = uuid();
        const agentId = `agent-${id}`;
        yield* store.insertSession(
          id,
          { iso: "omarchy.iso", disk: "/tmp/disk.qcow2" },
          "downloading",
        );
        expect(yield* store.getSessionStatus(id)).toEqual(Option.some("downloading"));
        yield* store.sessionRunning(id);
        expect(yield* store.getSessionStatus(id)).toEqual(Option.some("running"));
        yield* store.registerAgent(agentId, id);
        expect(yield* store.sessionForAgent(agentId)).toEqual(Option.some(id));
        expect(yield* store.sessionExists(id.toUpperCase())).toEqual(Option.some(id));
        expect(yield* store.sessionExists(uuid())).toEqual(Option.none());

        yield* store.endSession(id, "succeeded", "done");

        const [session] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.sessions).where(eq(DbSchema.sessions.id, id)),
        );
        const [run] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.agentRuns).where(eq(DbSchema.agentRuns.agentId, agentId)),
        );
        expect(session?.status).toBe("succeeded");
        expect(session?.reason).toBe("done");
        expect(session?.config).toEqual({ iso: "omarchy.iso", disk: "/tmp/disk.qcow2" });
        expect(session?.endedAt).toBeInstanceOf(Date);
        expect(run?.endedAt?.getTime()).toBe(session?.endedAt?.getTime());
        expect(yield* store.getSessionStatus(uuid())).toEqual(Option.none());
      }),
    );

    scoped.effect("registerAgent refuses a second session for the same agent", () =>
      Effect.gen(function* () {
        const store = yield* Sessions.SessionStore;
        const agentId = `agent-${uuid()}`;
        const first = uuid();
        const second = uuid();
        yield* store.insertSession(first, { iso: "x" }, "running");
        yield* store.insertSession(second, { iso: "x" }, "running");
        yield* store.registerAgent(agentId, first);
        const error = yield* Effect.flip(store.registerAgent(agentId, second));
        expect(error._tag).toBe("DatabaseError");
        expect(error.operation).toBe("registerAgent");
        expect(error.message).toContain("Failed query");
        expect(String(error.cause)).toContain("duplicate key");
      }),
    );

    scoped.effect("listSessions orders newest first and active running before downloading", () =>
      Effect.gen(function* () {
        const store = yield* Sessions.SessionStore;
        const all = yield* store.listSessions(1000, false);
        const ids = all.map((row) => row.id);
        expect(ids).toContain(SEEDED_SUCCEEDED);
        expect(ids).toContain(SEEDED_RUNNING);
        for (let index = 1; index < all.length; index++) {
          expect(all[index - 1].startedAt.getTime()).toBeGreaterThanOrEqual(
            all[index].startedAt.getTime(),
          );
        }
        const two = yield* store.listSessions(2, false);
        expect(two).toHaveLength(2);
        const active = yield* store.listSessions(1000, true);
        expect(
          active.every((row) => row.status === "running" || row.status === "downloading"),
        ).toBe(true);
        const firstDownloading = active.findIndex((row) => row.status === "downloading");
        const lastRunning = active.map((row) => row.status).lastIndexOf("running");
        if (firstDownloading !== -1 && lastRunning !== -1) {
          expect(lastRunning).toBeLessThan(firstDownloading);
        }
      }),
    );

    scoped.effect("ActionStore records an action and its image in one transaction", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const actions = yield* Actions.ActionStore;
        const sessionId = uuid();
        const agentId = `agent-${sessionId}`;
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.registerAgent(agentId, sessionId);
        const request = {
          execute: "screendump",
          arguments: { filename: "/tmp/x.png", format: "png" },
          id: 7,
        } as const;
        const id = yield* actions.startAction({ sessionId, agentId, request });
        const imageId = uuid();
        yield* actions.finishAction(
          id,
          { state: "completed", response: { return: {}, id: 7 } },
          { id: imageId, data: new Uint8Array([137, 80, 78, 71]) },
        );
        const rows = yield* actions.listActions(sessionId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id,
          sessionId,
          agentId,
          request,
          state: "completed",
          response: { return: {}, id: 7 },
        });
        expect(rows[0]?.finishedAt).toBeInstanceOf(Date);
        const image = yield* actions.getImage(imageId);
        expect(Option.isSome(image)).toBe(true);
        if (Option.isSome(image)) {
          expect([...image.value]).toEqual([137, 80, 78, 71]);
        }
        expect(yield* actions.getImage(uuid())).toEqual(Option.none());
      }),
    );

    scoped.effect("a failing image insert leaves the action open", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const actions = yield* Actions.ActionStore;
        const sessionId = uuid();
        const agentId = `agent-${sessionId}`;
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.registerAgent(agentId, sessionId);
        const id = yield* actions.startAction({
          sessionId,
          agentId,
          request: { execute: "qmp_capabilities", arguments: {}, id: 1 },
        });
        const error = yield* Effect.flip(
          actions.finishAction(
            id,
            { state: "completed", response: { return: {} } },
            { id: "not-a-uuid", data: new Uint8Array([1]) },
          ),
        );
        expect(error._tag).toBe("DatabaseError");
        expect(error.operation).toBe("finishAction");
        const [row] = yield* actions.listActions(sessionId);
        expect(row?.state).toBeNull();
        expect(row?.finishedAt).toBeNull();
      }),
    );

    scoped.effect("finishAction without an image closes the row with the failed reply", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const actions = yield* Actions.ActionStore;
        const sessionId = uuid();
        const agentId = `agent-${sessionId}`;
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.registerAgent(agentId, sessionId);
        const id = yield* actions.startAction({
          sessionId,
          agentId,
          request: {
            execute: "send-key",
            arguments: { keys: [{ type: "qcode", data: "a" }] },
            id: 2,
          },
        });
        yield* actions.finishAction(id, { state: "failed", response: "qemu: send-key timed out" });
        const [row] = yield* actions.listActions(sessionId);
        expect(row).toMatchObject({ state: "failed", response: "qemu: send-key timed out" });
      }),
    );

    scoped.effect("a transaction body failure rolls back the rows it inserted", () =>
      Effect.gen(function* () {
        const database = yield* Client.Database;
        const sessions = yield* Sessions.SessionStore;
        const id = uuid();
        const error = yield* Effect.flip(
          database.transaction("test", (tx) =>
            Effect.gen(function* () {
              yield* Client.attempt("insert", () =>
                tx
                  .insert(DbSchema.sessions)
                  .values({ id, config: { iso: "x" }, status: "running" }),
              );
              return yield* Errors.CommandError.make({
                message: "test: no test definitions found",
              });
            }),
          ),
        );
        expect(error).toMatchObject({
          _tag: "CommandError",
          message: "test: no test definitions found",
        });
        expect(yield* sessions.sessionExists(id)).toEqual(Option.none());
      }),
    );

    scoped.effect("a transaction body success commits", () =>
      Effect.gen(function* () {
        const database = yield* Client.Database;
        const sessions = yield* Sessions.SessionStore;
        const id = uuid();
        const value = yield* database.transaction("test", (tx) =>
          Effect.gen(function* () {
            yield* Client.attempt("insert", () =>
              tx.insert(DbSchema.sessions).values({ id, config: { iso: "x" }, status: "running" }),
            );
            return "committed";
          }),
        );
        expect(value).toBe("committed");
        expect(yield* sessions.sessionExists(id)).toEqual(Option.some(id));
      }),
    );

    scoped.effect("LogStore lists rows in insertion order", () =>
      Effect.gen(function* () {
        const logs = yield* Logs.LogStore;
        const sessionId = uuid();
        yield* logs.insertLog({ text: "first", level: "info", sessionId, agentId: "OLI-1" });
        yield* logs.insertLog({ text: "second", level: "error", sessionId, agentId: null });
        yield* logs.insertLog({ text: "global", level: "warning", sessionId: null, agentId: null });
        const rows = yield* logs.listLogs(sessionId);
        expect(rows.map((row) => row.text)).toEqual(["first", "second"]);
        expect(rows[0]).toMatchObject({ level: "info", sessionId, agentId: "OLI-1" });
        expect(rows[1]).toMatchObject({ level: "error", agentId: null });
        expect(yield* logs.listLogs(uuid())).toEqual([]);
      }),
    );

    scoped.effect("TestStore reads the seeded definitions and prompts", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const definitions = yield* tests.listTestDefinitions;
        expect(definitions.map((row) => row.name)).toContain("lock-screen");
        const found = yield* tests.findTestDefinition("lock-screen");
        expect(Option.isSome(found)).toBe(true);
        expect(yield* tests.findTestDefinition("nope")).toEqual(Option.none());
        const prompts = yield* tests.listTestBasePrompts;
        expect(prompts.map((row) => row.name)).toContain("base");
      }),
    );

    scoped.effect("TestStore runs a result through its lifecycle", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const sessions = yield* Sessions.SessionStore;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        expect(created.results).toHaveLength(1);
        const [result] = created.results;
        expect(result?.definitionId).toBe(definition.id);

        const sessionId = uuid();
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        expect(yield* tests.startResult(result.id, sessionId)).toBe(true);
        expect(yield* tests.startResult(result.id, sessionId)).toBe(false);
        expect(yield* tests.startResult(uuid(), sessionId)).toBe(false);

        const joined = yield* tests.resultForSession(sessionId);
        expect(joined).toHaveLength(1);
        expect(joined[0]?.result.status).toBe("running");
        expect(joined[0]?.definition.name).toBe("lock-screen");

        expect(yield* tests.closeResult(result.id, "passed", "it locked", null)).toBe(true);
        const [closed] = yield* tests.resultForSession(sessionId);
        expect(closed?.result).toMatchObject({ status: "passed", reason: "it locked", sessionId });
        expect(closed?.result.finishedAt).toBeInstanceOf(Date);
        // A verdict without a reason leaves the stored one, as v1's undefined did.
        expect(yield* tests.closeResult(result.id, "failed", null, null)).toBe(true);
        const [reclosed] = yield* tests.resultForSession(sessionId);
        expect(reclosed?.result).toMatchObject({
          status: "failed",
          reason: "it locked",
          sessionId,
        });
        expect(yield* tests.closeResult(result.id, "failed", "installer hung", null)).toBe(true);
        const [reasoned] = yield* tests.resultForSession(sessionId);
        expect(reasoned?.result.reason).toBe("installer hung");
        expect(yield* tests.closeResult(uuid(), "failed", null, null)).toBe(false);
        expect(yield* tests.resultForSession(uuid())).toEqual([]);
      }),
    );

    scoped.effect("TestStore.failRun marks the run and every result failed", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const database = yield* Client.Database;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        yield* tests.failRun(created.runId, "linear: request failed (401)");
        const [run] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.testRuns).where(eq(DbSchema.testRuns.id, created.runId)),
        );
        expect(run).toMatchObject({
          name: "Omarchy experiment",
          status: "failed",
          reason: "linear: request failed (401)",
        });
        expect(run?.endedAt).toBeInstanceOf(Date);
        const results = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.testResults)
            .where(eq(DbSchema.testResults.runId, created.runId)),
        );
        expect(results.map((row) => row.status)).toEqual(["failed"]);
        expect(results[0]?.reason).toBe("linear: request failed (401)");
        expect(results[0]?.finishedAt?.getTime()).toBe(run?.endedAt?.getTime());
      }),
    );

    scoped.effect("ping succeeds against the container", () =>
      Effect.gen(function* () {
        const database = yield* Client.Database;
        yield* database.ping;
      }),
    );
  });

  it.effect("Database.layer ends the pool when its scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        Layer.fresh(Postgres.DatabaseLive(Postgres.getDbUrl())),
        scope,
      );
      const database = Context.get(context, Client.Database);
      yield* database.ping;
      yield* Scope.close(scope, Exit.void);
      const error = yield* Effect.flip(database.run("select", (db) => db.execute(sql`select 1`)));
      expect(error._tag).toBe("DatabaseError");
      expect(error.message).toContain("Failed query: select 1");
      expect(Render.headline(error)).toContain("Cannot use a pool after calling end");
    }),
  );

  it.effect("ping against a closed port fails DatabaseError", () =>
    Effect.gen(function* () {
      const database = yield* Client.Database.make(
        Redacted.make("postgres://user:pw@127.0.0.1:1/x"),
      );
      const exit = yield* Effect.exit(database.ping);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        expect(error).toMatchObject({ _tag: "DatabaseError", operation: "ping" });
        expect(Cause.pretty(exit.cause)).toContain("ECONNREFUSED");
      }
    }),
  );
});
