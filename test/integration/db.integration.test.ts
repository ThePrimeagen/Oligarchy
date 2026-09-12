import { expect } from "vitest";
import { it, layer } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { Cause, Context, Effect, Exit, Layer, Option, Redacted, Scope } from "effect";
import { TestConsole } from "effect/testing";
import * as Actions from "../../src/db/actions.ts";
import * as Client from "../../src/db/client.ts";
import * as DebugLogs from "../../src/db/debug-logs.ts";
import * as Diagnosis from "../../src/db/diagnosis.ts";
import * as Logs from "../../src/db/logs.ts";
import * as Migrate from "../../src/db/migrate.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as ProcessStats from "../../src/db/process-stats.ts";
import * as Servers from "../../src/db/servers.ts";
import * as Sessions from "../../src/db/sessions.ts";
import * as Automation from "../../src/db/automation.ts";
import * as Tests from "../../src/db/tests.ts";
import * as Render from "../../src/observability/render.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Support from "../support/config.ts";
import * as Postgres from "../support/postgres.ts";

const uuid = (): string => crypto.randomUUID();

// A fresh snake_case key per test: the container's tables outlive each test body.
const errorKey = (stem: string): string => `${stem}_${uuid().replaceAll("-", "_")}`;

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

        // getSession is the whole row, as `ctrl session --status` prints it.
        const read = Option.getOrThrow(yield* store.getSession(id.toUpperCase()));
        expect(read).toMatchObject({
          id,
          config: { iso: "omarchy.iso", disk: "/tmp/disk.qcow2" },
          status: "succeeded",
          reason: "done",
        });
        expect(read.startedAt).toBeInstanceOf(Date);
        expect(read.endedAt).toBeInstanceOf(Date);
        expect(yield* store.getSession(uuid())).toEqual(Option.none());

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

    scoped.effect("ActionStore lists a session's images in action order, nobody else's", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const actions = yield* Actions.ActionStore;
        const sessionId = uuid();
        const otherId = uuid();
        const agentId = `agent-${sessionId}`;
        const otherAgent = `agent-${otherId}`;
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.insertSession(otherId, { iso: "x" }, "running");
        yield* sessions.registerAgent(agentId, sessionId);
        yield* sessions.registerAgent(otherAgent, otherId);
        const screendump = {
          execute: "screendump",
          arguments: { filename: "/tmp/x.png", format: "png" },
          id: 1,
        } as const;
        const shot = (session: string, agent: string) =>
          Effect.gen(function* () {
            const actionId = yield* actions.startAction({
              sessionId: session,
              agentId: agent,
              request: screendump,
            });
            const imageId = uuid();
            yield* actions.finishAction(
              actionId,
              { state: "completed", response: { return: {} } },
              { id: imageId, data: new Uint8Array([137]) },
            );
            return { id: imageId, actionId };
          });
        expect(yield* actions.listImages(sessionId)).toEqual([]);
        const first = yield* shot(sessionId, agentId);
        yield* shot(otherId, otherAgent);
        const second = yield* shot(sessionId, agentId);
        // A screendump that failed leaves no image behind and so no entry here.
        const failed = yield* actions.startAction({ sessionId, agentId, request: screendump });
        yield* actions.finishAction(failed, {
          state: "failed",
          response: { error: { class: "GenericError", desc: "no display" } },
        });

        const listed = yield* actions.listImages(sessionId);
        expect(listed.map((row) => [row.id, row.actionId])).toEqual([
          [first.id, first.actionId],
          [second.id, second.actionId],
        ]);
        for (const row of listed) {
          expect(row.createdAt).toBeInstanceOf(Date);
          expect(Object.keys(row).sort()).toEqual(["actionId", "createdAt", "id"]);
        }
        expect(yield* actions.listImages(uuid())).toEqual([]);
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
        yield* logs.insertLog({
          text: "first",
          level: "info",
          location: sessionId,
          agentId: "OLI-1",
        });
        yield* logs.insertLog({
          text: "second",
          level: "error",
          location: sessionId,
          agentId: null,
        });
        yield* logs.insertLog({
          text: "global",
          level: "warning",
          location: "server",
          agentId: null,
        });
        yield* logs.insertLog({
          text: "queue claimed",
          level: "info",
          location: "automation",
          agentId: "automation",
        });
        const rows = yield* logs.listLogs(sessionId);
        expect(rows.map((row) => row.text)).toEqual(["first", "second"]);
        expect(rows[0]).toMatchObject({ level: "info", location: sessionId, agentId: "OLI-1" });
        expect(rows[1]).toMatchObject({ level: "error", agentId: null });
        expect(yield* logs.listLogs(uuid())).toEqual([]);
        expect((yield* logs.listLogs("server")).map((row) => row.text)).toEqual(["global"]);
        expect((yield* logs.listLogs("automation")).map((row) => row.text)).toEqual([
          "queue claimed",
        ]);
      }),
    );

    scoped.effect("DebugLogStore snapshots each origin into sources", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const logs = yield* Logs.LogStore;
        const actions = yield* Actions.ActionStore;
        const debugLogs = yield* DebugLogs.DebugLogStore;
        const database = yield* Client.Database;
        const sessionId = uuid();
        const agentId = `agent-${sessionId}`;
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.registerAgent(agentId, sessionId);
        yield* logs.insertLog({
          text: "running; started in 12ms",
          level: "info",
          location: sessionId,
          agentId: "OLI-1",
        });
        yield* logs.insertLog({
          text: "GET /image failed: qemu: closed",
          level: "error",
          location: sessionId,
          agentId: "OLI-1",
        });
        yield* actions.startAction({
          sessionId,
          agentId,
          request: {
            execute: "screendump",
            arguments: { filename: "/tmp/x.png", format: "png" },
            id: 7,
          },
        });
        yield* debugLogs.saveDebugLog(sessionId, {
          serial: "journalctl\nfailed unit",
          qemu: "kvm: not available\n",
        });
        const [saved] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.debugLogs).where(eq(DbSchema.debugLogs.sessionId, sessionId)),
        );
        expect(Object.keys(saved?.sources ?? {}).sort()).toEqual([
          "actions",
          "proxy",
          "qemu",
          "serial",
        ]);
        expect(saved?.sources.serial).toBe("journalctl\nfailed unit");
        expect(saved?.sources.qemu).toBe("kvm: not available\n");
        expect(saved?.sources.proxy).toContain("info running; started in 12ms");
        expect(saved?.sources.proxy).toContain("error GET /image failed: qemu: closed");
        expect(saved?.sources.actions).toContain("screendump");
        const missing = yield* database.run("select", (db) =>
          db.select().from(DbSchema.debugLogs).where(eq(DbSchema.debugLogs.sessionId, uuid())),
        );
        expect(missing).toEqual([]);
        // The read path ctrl uses: the row as saved, None for a session without one.
        const read = yield* debugLogs.getDebugLog(sessionId);
        expect(Option.isSome(read)).toBe(true);
        expect(Option.getOrThrow(read).sources.serial).toBe("journalctl\nfailed unit");
        expect(Option.getOrThrow(read).sessionId).toBe(sessionId);
        expect(Option.getOrThrow(read).createdAt).toBeInstanceOf(Date);
        expect(Option.isNone(yield* debugLogs.getDebugLog(uuid()))).toBe(true);
      }),
    );

    scoped.effect("DebugLogStore refuses a second debug log for the same session", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const debugLogs = yield* DebugLogs.DebugLogStore;
        const database = yield* Client.Database;
        const sessionId = uuid();
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* debugLogs.saveDebugLog(sessionId, { serial: "first", qemu: "" });
        const error = yield* Effect.flip(
          debugLogs.saveDebugLog(sessionId, { serial: "second", qemu: "" }),
        );
        expect(error._tag).toBe("DatabaseError");
        expect(error.operation).toBe("saveDebugLog");
        expect(error.message).toContain("Failed query");
        expect(String(error.cause)).toContain("duplicate key");
        const [saved] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.debugLogs).where(eq(DbSchema.debugLogs.sessionId, sessionId)),
        );
        expect(saved?.sources.serial).toBe("first");
      }),
    );

    scoped.effect("DebugLogStore refuses a debug log for an unknown session", () =>
      Effect.gen(function* () {
        const debugLogs = yield* DebugLogs.DebugLogStore;
        const error = yield* Effect.flip(
          debugLogs.saveDebugLog(uuid(), { serial: "orphan", qemu: "" }),
        );
        expect(error._tag).toBe("DatabaseError");
        expect(error.operation).toBe("saveDebugLog");
        expect(error.message).toContain("Failed query");
      }),
    );

    scoped.effect("DebugLogStore keeps each origin's tail when a source exceeds the cap", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const debugLogs = yield* DebugLogs.DebugLogStore;
        const database = yield* Client.Database;
        const sessionId = uuid();
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        const serial = `head-noise\n${"z".repeat(1_048_576)}crash-tail`;
        yield* debugLogs.saveDebugLog(sessionId, {
          serial,
          qemu: "kvm: not available\n",
        });
        const [saved] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.debugLogs).where(eq(DbSchema.debugLogs.sessionId, sessionId)),
        );
        expect(saved?.sources.serial.startsWith("[truncated]\n")).toBe(true);
        expect(saved?.sources.serial.endsWith("crash-tail")).toBe(true);
        expect(saved?.sources.serial.length).toBe(1_048_576);
        expect(saved?.sources.qemu).toBe("kvm: not available\n");
        expect(saved?.sources.proxy).toBe("");
        expect(saved?.sources.actions).toBe("");
      }),
    );

    scoped.effect("DiagnosisStore creates, lists and finds error types; a taken key is false", () =>
      Effect.gen(function* () {
        const diagnosis = yield* Diagnosis.DiagnosisStore;
        const boot = errorKey("guest_boot_hang");
        const misread = errorKey("agent_misread_screen");
        expect(yield* diagnosis.createErrorType(boot, "never reached login")).toBe(true);
        expect(yield* diagnosis.createErrorType(misread, "acted on a misread screen")).toBe(true);
        expect(yield* diagnosis.createErrorType(boot, "a second meaning")).toBe(false);

        const listed = yield* diagnosis.listErrorTypes();
        const keys = listed.map((row) => row.key);
        expect(keys).toContain(boot);
        expect(keys).toContain(misread);
        expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
        expect(listed.find((row) => row.key === boot)?.description).toBe("never reached login");
        expect(listed.find((row) => row.key === boot)?.createdAt).toBeInstanceOf(Date);

        const found = yield* diagnosis.findErrorType(boot);
        expect(Option.getOrThrow(found)).toMatchObject({
          key: boot,
          description: "never reached login",
        });
        expect(yield* diagnosis.findErrorType(errorKey("nope"))).toEqual(Option.none());
      }),
    );

    scoped.effect("DiagnosisStore writes one diagnosis per session and reads it back", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const diagnosis = yield* Diagnosis.DiagnosisStore;
        const database = yield* Client.Database;
        const sessionId = uuid();
        const boot = errorKey("guest_boot_hang");
        const misread = errorKey("agent_misread_screen");
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.endSession(sessionId, "failed", "installer hung");
        yield* diagnosis.createErrorType(boot, "never reached login");
        yield* diagnosis.createErrorType(misread, "acted on a misread screen");

        expect(
          yield* diagnosis.saveDiagnosis({
            sessionId,
            verdict: "failed",
            errorType: boot,
            summary: "the kernel waited on the root device",
            model: "composer-2.5",
          }),
        ).toBe(true);
        // The key is the session: a second diagnosis is a false and the first stands.
        expect(
          yield* diagnosis.saveDiagnosis({
            sessionId: sessionId.toUpperCase(),
            verdict: "failed",
            errorType: misread,
            summary: "on reflection",
            model: "grok-4.6",
          }),
        ).toBe(false);

        const read = Option.getOrThrow(yield* diagnosis.getDiagnosis(sessionId));
        expect(read).toMatchObject({
          sessionId,
          verdict: "failed",
          errorType: boot,
          summary: "the kernel waited on the root device",
          model: "composer-2.5",
        });
        expect(read.createdAt).toBeInstanceOf(Date);
        expect(Object.keys(read).sort()).toEqual([
          "createdAt",
          "errorType",
          "model",
          "sessionId",
          "summary",
          "verdict",
        ]);
        expect(yield* diagnosis.getDiagnosis(uuid())).toEqual(Option.none());
        const rows = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.postRunDiagnosis)
            .where(eq(DbSchema.postRunDiagnosis.sessionId, sessionId)),
        );
        expect(rows).toHaveLength(1);
      }),
    );

    scoped.effect(
      "DiagnosisStore writes a passed verdict without a cause, on any ended session",
      () =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.SessionStore;
          const diagnosis = yield* Diagnosis.DiagnosisStore;
          const succeeded = uuid();
          const failed = uuid();
          yield* sessions.insertSession(succeeded, { iso: "x" }, "running");
          yield* sessions.endSession(succeeded, "succeeded", "lock screen on screen");
          yield* sessions.insertSession(failed, { iso: "x" }, "running");
          yield* sessions.endSession(failed, "failed", "gave up");
          for (const sessionId of [succeeded, failed]) {
            expect(
              yield* diagnosis.saveDiagnosis({
                sessionId,
                verdict: "passed",
                errorType: null,
                summary: "the last image shows the proof",
                model: "composer-2.5",
              }),
            ).toBe(true);
            expect(Option.getOrThrow(yield* diagnosis.getDiagnosis(sessionId))).toMatchObject({
              sessionId,
              verdict: "passed",
              errorType: null,
            });
          }
        }),
    );

    scoped.effect("the table refuses a passed verdict with a cause and a failed one without", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const diagnosis = yield* Diagnosis.DiagnosisStore;
        const sessionId = uuid();
        const boot = errorKey("guest_boot_hang");
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.endSession(sessionId, "failed", null);
        yield* diagnosis.createErrorType(boot, "never reached login");
        const typedPass = yield* Effect.flip(
          diagnosis.saveDiagnosis({
            sessionId,
            verdict: "passed",
            errorType: boot,
            summary: "s",
            model: "composer-2.5",
          }),
        );
        expect(typedPass).toMatchObject({ _tag: "DatabaseError", operation: "saveDiagnosis" });
        expect(String(typedPass.cause)).toMatch(/check constraint/);
        const untypedFailure = yield* Effect.flip(
          diagnosis.saveDiagnosis({
            sessionId,
            verdict: "failed",
            errorType: null,
            summary: "s",
            model: "composer-2.5",
          }),
        );
        expect(untypedFailure).toMatchObject({ _tag: "DatabaseError", operation: "saveDiagnosis" });
        expect(String(untypedFailure.cause)).toMatch(/check constraint/);
        expect(yield* diagnosis.getDiagnosis(sessionId)).toEqual(Option.none());
      }),
    );

    scoped.effect("DiagnosisStore refuses a diagnosis naming an unknown type or session", () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions.SessionStore;
        const diagnosis = yield* Diagnosis.DiagnosisStore;
        const sessionId = uuid();
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        yield* sessions.endSession(sessionId, "failed", null);
        const unknownType = yield* Effect.flip(
          diagnosis.saveDiagnosis({
            sessionId,
            verdict: "failed",
            errorType: errorKey("never_created"),
            summary: "s",
            model: "composer-2.5",
          }),
        );
        expect(unknownType).toMatchObject({
          _tag: "DatabaseError",
          operation: "saveDiagnosis",
          message: expect.stringContaining("Failed query"),
        });
        expect(String(unknownType.cause)).toMatch(/foreign key/);
        expect(yield* diagnosis.getDiagnosis(sessionId)).toEqual(Option.none());

        const boot = errorKey("guest_boot_hang");
        yield* diagnosis.createErrorType(boot, "never reached login");
        const unknownSession = yield* Effect.flip(
          diagnosis.saveDiagnosis({
            sessionId: uuid(),
            verdict: "failed",
            errorType: boot,
            summary: "s",
            model: "composer-2.5",
          }),
        );
        expect(unknownSession).toMatchObject({
          _tag: "DatabaseError",
          operation: "saveDiagnosis",
          message: expect.stringContaining("Failed query"),
        });
        expect(String(unknownSession.cause)).toMatch(/foreign key/);
      }),
    );

    scoped.effect(
      "renaming an error type follows into its diagnoses; deleting one in use is refused",
      () =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.SessionStore;
          const diagnosis = yield* Diagnosis.DiagnosisStore;
          const database = yield* Client.Database;
          const sessionId = uuid();
          const before = errorKey("guest_boot_hang");
          const after = errorKey("guest_boot_stall");
          yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
          yield* sessions.endSession(sessionId, "timed_out", null);
          yield* diagnosis.createErrorType(before, "never reached login");
          yield* diagnosis.saveDiagnosis({
            sessionId,
            verdict: "failed",
            errorType: before,
            summary: "s",
            model: "composer-2.5",
          });

          const refused = yield* Effect.flip(
            database.run("delete", (db) =>
              db
                .delete(DbSchema.postRunErrorTypes)
                .where(eq(DbSchema.postRunErrorTypes.key, before)),
            ),
          );
          expect(refused).toMatchObject({
            _tag: "DatabaseError",
            operation: "delete",
            message: expect.stringContaining("Failed query"),
          });
          expect(String(refused.cause)).toMatch(/foreign key/);

          yield* database.run("rename", (db) =>
            db
              .update(DbSchema.postRunErrorTypes)
              .set({ key: after })
              .where(eq(DbSchema.postRunErrorTypes.key, before)),
          );
          expect(Option.getOrThrow(yield* diagnosis.getDiagnosis(sessionId)).errorType).toBe(after);
          expect(yield* diagnosis.findErrorType(before)).toEqual(Option.none());
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

    // A definition is never updated: an edit is a new row with the same name and a higher id, and
    // the latest wording of a name is its highest id.
    scoped.effect("TestStore resolves a name to its newest row and lists one row per name", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const name = `revised-${uuid()}`;
        const first = yield* tests.defineTestDefinition({
          name,
          description: "d1",
          instruction: "i1",
          proof: "p1",
        });
        const second = yield* tests.defineTestDefinition({
          name,
          description: "d1",
          instruction: "i2",
          proof: "p1",
        });
        expect(first).toEqual({ id: expect.any(Number), version: 1 });
        expect(second).toEqual({ id: expect.any(Number), version: 2 });
        expect(second.id).toBeGreaterThan(first.id);

        const latest = Option.getOrThrow(yield* tests.findTestDefinition(name));
        expect(latest).toMatchObject({ id: second.id, name, instruction: "i2" });

        const listed = yield* tests.listTestDefinitions;
        expect(listed.filter((row) => row.name === name)).toEqual([latest]);
        const names = listed.map((row) => row.name);
        expect(new Set(names).size).toBe(names.length);
      }),
    );

    scoped.effect("TestStore lists a definition's history oldest first, and every name's", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const name = `history-${uuid()}`;
        const first = yield* tests.defineTestDefinition({
          name,
          description: "d",
          instruction: "i1",
          proof: "p",
        });
        const second = yield* tests.defineTestDefinition({
          name,
          description: "d",
          instruction: "i2",
          proof: "p",
        });
        const named = yield* tests.listTestDefinitionHistory(Option.some(name));
        expect(named.map((row) => [row.id, row.instruction])).toEqual([
          [first.id, "i1"],
          [second.id, "i2"],
        ]);
        const every = yield* tests.listTestDefinitionHistory(Option.none());
        expect(every.filter((row) => row.name === name)).toEqual(named);
        expect(every.map((row) => row.name)).toContain("lock-screen");
        expect(yield* tests.listTestDefinitionHistory(Option.some(`nope-${uuid()}`))).toEqual([]);
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
        // A result is found by its id from creation on; it names no session until start.
        expect(Option.getOrThrow(yield* tests.findResult(result.id))).toMatchObject({
          id: result.id,
          runId: created.runId,
          sessionId: null,
          status: "pending",
        });

        const sessionId = uuid();
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        expect(yield* tests.startResult(result.id, sessionId, "composer-2.5")).toBe(true);
        expect(yield* tests.startResult(result.id, sessionId, "composer-2.5")).toBe(false);
        expect(yield* tests.startResult(uuid(), sessionId, "composer-2.5")).toBe(false);
        expect(Option.getOrThrow(yield* tests.findResult(result.id))).toMatchObject({
          sessionId,
          status: "running",
          model: "composer-2.5",
        });
        expect(Option.isNone(yield* tests.findResult(uuid()))).toBe(true);

        // A newer wording of the same name does not move the result: it pinned the row it ran.
        const revised = yield* tests.defineTestDefinition({
          name: "lock-screen",
          description: definition.description,
          instruction: `${definition.instruction} (revised ${uuid()})`,
          proof: definition.proof,
        });
        expect(revised.id).toBeGreaterThan(definition.id);
        const joined = yield* tests.resultForSession(sessionId);
        expect(joined).toHaveLength(1);
        expect(joined[0]?.result.status).toBe("running");
        expect(joined[0]?.result.model).toBe("composer-2.5");
        expect(joined[0]?.definition).toEqual(definition);
        expect(joined[0]?.run).toMatchObject({
          id: created.runId,
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          status: "pending",
        });

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

    scoped.effect("createRun leaves model null; startResult writes the model that ran", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const sessions = yield* Sessions.SessionStore;
        const database = yield* Client.Database;
        const lock = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const [install] = yield* database.run("insert", (db) =>
          db
            .insert(DbSchema.testDefinitions)
            .values({
              name: `install-models-${uuid()}`,
              description: "d",
              instruction: "i",
              proof: "p",
            })
            .returning({ id: DbSchema.testDefinitions.id }),
        );
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: lock.id }, { id: install.id }],
        });
        const [run] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.testRuns).where(eq(DbSchema.testRuns.id, created.runId)),
        );
        expect(run).not.toHaveProperty("model");
        const pending = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.testResults)
            .where(eq(DbSchema.testResults.runId, created.runId)),
        );
        expect(pending.map((row) => row.model)).toEqual([null, null]);
        const firstSession = uuid();
        const secondSession = uuid();
        yield* sessions.insertSession(firstSession, { iso: "x" }, "running");
        yield* sessions.insertSession(secondSession, { iso: "x" }, "running");
        expect(yield* tests.startResult(created.results[0].id, firstSession, "grok-4.6")).toBe(
          true,
        );
        expect(yield* tests.startResult(created.results[1].id, secondSession, "composer-2.5")).toBe(
          true,
        );
        const started = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.testResults)
            .where(eq(DbSchema.testResults.runId, created.runId)),
        );
        expect(
          [...new Set(started.map((row) => row.model))].sort((left, right) =>
            (left ?? "").localeCompare(right ?? ""),
          ),
        ).toEqual(["composer-2.5", "grok-4.6"]);
      }),
    );

    scoped.effect("a result may store a null model", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const database = yield* Client.Database;
        const lock = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const [run] = yield* database.run("insert", (db) =>
          db
            .insert(DbSchema.testRuns)
            .values({
              name: "Omarchy experiment",
              iso: "https://example.com/omarchy.iso",
              serverUrl: "http://127.0.0.1:42069",
            })
            .returning({ id: DbSchema.testRuns.id }),
        );
        const [result] = yield* database.run("insert", (db) =>
          db
            .insert(DbSchema.testResults)
            .values({ runId: run.id, definitionId: lock.id, status: "pending" })
            .returning({ id: DbSchema.testResults.id, model: DbSchema.testResults.model }),
        );
        expect(result.model).toBeNull();
      }),
    );

    scoped.effect("TestStore refuses a second result for the same session (unhappy)", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const sessions = yield* Sessions.SessionStore;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const first = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const second = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const sessionId = uuid();
        yield* sessions.insertSession(sessionId, { iso: "x" }, "running");
        expect(yield* tests.startResult(first.results[0].id, sessionId, "composer-2.5")).toBe(true);
        const error = yield* Effect.flip(
          tests.startResult(second.results[0].id, sessionId, "composer-2.5"),
        );
        expect(error._tag).toBe("DatabaseError");
        expect(error.message).toMatch(/test_results_session_id_idx/);
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
        expect(run).not.toHaveProperty("model");
        expect(run?.endedAt).toBeInstanceOf(Date);
        const results = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.testResults)
            .where(eq(DbSchema.testResults.runId, created.runId)),
        );
        expect(results.map((row) => row.status)).toEqual(["failed"]);
        expect(results[0]?.reason).toBe("linear: request failed (401)");
        expect(results[0]?.model).toBeNull();
        expect(results[0]?.finishedAt?.getTime()).toBe(run?.endedAt?.getTime());
      }),
    );

    scoped.effect("TestStore.setLinearId writes the identifier and finds the result by it", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const resultId = created.results[0].id;
        yield* tests.setLinearId(resultId, "OLI-100");
        expect(Option.getOrThrow(yield* tests.findResult(resultId)).linearId).toBe("OLI-100");
        expect(Option.getOrThrow(yield* tests.findResultByLinearId("OLI-100")).id).toBe(resultId);
        expect(Option.isNone(yield* tests.findResultByLinearId("OLI-missing"))).toBe(true);
        const missing = yield* Effect.exit(tests.setLinearId(uuid(), "OLI-101"));
        expect(Exit.isFailure(missing) && Cause.hasDies(missing.cause)).toBe(true);
      }),
    );

    scoped.effect(
      "TestStore.setLinearId refuses a second result with the same linear id (unhappy)",
      () =>
        Effect.gen(function* () {
          const tests = yield* Tests.TestStore;
          const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
          const first = yield* tests.createRun({
            iso: "https://example.com/omarchy.iso",
            serverUrl: "http://127.0.0.1:42069",
            definitions: [{ id: definition.id }],
          });
          const second = yield* tests.createRun({
            iso: "https://example.com/omarchy.iso",
            serverUrl: "http://127.0.0.1:42069",
            definitions: [{ id: definition.id }],
          });
          yield* tests.setLinearId(first.results[0].id, "OLI-200");
          const error = yield* Effect.flip(tests.setLinearId(second.results[0].id, "OLI-200"));
          expect(error._tag).toBe("DatabaseError");
          expect(error.operation).toBe("setLinearId");
          expect(String(error.cause)).toContain("duplicate key");
        }),
    );

    scoped.effect("AutomationStore enqueues a pending drive and diagnose for one result", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const automation = yield* Automation.AutomationStore;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const resultId = created.results[0].id;
        const drive = yield* automation.enqueue({ resultId, action: "drive" });
        const diagnose = yield* automation.enqueue({ resultId, action: "diagnose" });
        expect(drive).toMatchObject({ resultId, action: "drive", status: "pending" });
        expect(diagnose).toMatchObject({ resultId, action: "diagnose", status: "pending" });
      }),
    );

    scoped.effect(
      "AutomationStore refuses a second job for the same result and action (unhappy)",
      () =>
        Effect.gen(function* () {
          const tests = yield* Tests.TestStore;
          const automation = yield* Automation.AutomationStore;
          const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
          const created = yield* tests.createRun({
            iso: "https://example.com/omarchy.iso",
            serverUrl: "http://127.0.0.1:42069",
            definitions: [{ id: definition.id }],
          });
          const resultId = created.results[0].id;
          yield* automation.enqueue({ resultId, action: "drive" });
          const error = yield* Effect.flip(automation.enqueue({ resultId, action: "drive" }));
          expect(error._tag).toBe("DatabaseError");
          expect(error.operation).toBe("enqueueAutomationJob");
          expect(String(error.cause)).toContain("duplicate key");
        }),
    );

    scoped.effect("AutomationStore claims the oldest pending job, then none", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const automation = yield* Automation.AutomationStore;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const first = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const second = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const older = yield* automation.enqueue({ resultId: first.results[0].id, action: "drive" });
        const newer = yield* automation.enqueue({
          resultId: second.results[0].id,
          action: "drive",
        });
        const firstServer = crypto.randomUUID();
        const secondServer = crypto.randomUUID();
        expect(yield* automation.findRunning(older.resultId)).toEqual(Option.none());
        const claimed = yield* automation.claim(firstServer);
        expect(Option.isSome(claimed)).toBe(true);
        if (Option.isSome(claimed)) {
          expect(claimed.value).toMatchObject({
            id: older.id,
            status: "running",
            serverId: firstServer,
          });
          expect(claimed.value.startedAt).toBeInstanceOf(Date);
        }
        expect(yield* automation.findRunning(older.resultId)).toEqual(claimed);
        const next = yield* automation.claim(secondServer);
        expect(Option.isSome(next)).toBe(true);
        if (Option.isSome(next)) {
          expect(next.value).toMatchObject({ id: newer.id, serverId: secondServer });
        }
        expect(yield* automation.claim(crypto.randomUUID())).toEqual(Option.none());
      }),
    );

    scoped.effect("AutomationStore unclaim returns a running job to pending as it was", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const automation = yield* Automation.AutomationStore;
        const database = yield* Client.Database;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const enqueued = yield* automation.enqueue({
          resultId: created.results[0].id,
          action: "drive",
        });
        const createdAt = enqueued.createdAt;
        const serverId = crypto.randomUUID();
        yield* automation.claim(serverId);
        expect(yield* automation.unclaim(enqueued.id)).toBe(true);
        const [row] = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.automationJobs)
            .where(eq(DbSchema.automationJobs.id, enqueued.id)),
        );
        expect(row).toMatchObject({
          status: "pending",
          serverId: null,
          startedAt: null,
          finishedAt: null,
          reason: null,
        });
        expect(row?.createdAt).toEqual(createdAt);
        expect(yield* automation.unclaim(enqueued.id)).toBe(false);
      }),
    );

    scoped.effect("AutomationStore finish closes a running job and refuses a second close", () =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const automation = yield* Automation.AutomationStore;
        const database = yield* Client.Database;
        const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
        const created = yield* tests.createRun({
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          definitions: [{ id: definition.id }],
        });
        const enqueued = yield* automation.enqueue({
          resultId: created.results[0].id,
          action: "drive",
        });
        const claimed = yield* automation.claim(crypto.randomUUID());
        expect(Option.isSome(claimed)).toBe(true);
        expect(yield* automation.findRunning(created.results[0].id)).toEqual(claimed);
        expect(yield* automation.finish(enqueued.id, "succeeded", null)).toBe(true);
        expect(yield* automation.findRunning(created.results[0].id)).toEqual(Option.none());
        const [row] = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.automationJobs)
            .where(eq(DbSchema.automationJobs.id, enqueued.id)),
        );
        expect(row).toMatchObject({ status: "succeeded", reason: null });
        expect(row?.finishedAt).toBeInstanceOf(Date);
        expect(yield* automation.finish(enqueued.id, "failed", "nope")).toBe(false);
        const [again] = yield* database.run("select", (db) =>
          db
            .select()
            .from(DbSchema.automationJobs)
            .where(eq(DbSchema.automationJobs.id, enqueued.id)),
        );
        expect(again).toMatchObject({ status: "succeeded", reason: null });
      }),
    );

    scoped.effect(
      "AutomationStore listJobs returns every running and pending job, diagnoses first, and the newest completed up to count",
      () =>
        Effect.gen(function* () {
          const tests = yield* Tests.TestStore;
          const automation = yield* Automation.AutomationStore;
          const database = yield* Client.Database;
          const definition = Option.getOrThrow(yield* tests.findTestDefinition("lock-screen"));
          const created = yield* Effect.forEach([0, 1, 2, 3, 4, 5], () =>
            tests.createRun({
              iso: "https://example.com/omarchy.iso",
              serverUrl: "http://127.0.0.1:42069",
              definitions: [{ id: definition.id }],
            }),
          );
          const resultIds = created.map((run) => run.results[0].id);
          yield* tests.setLinearId(resultIds[0], "LST-101");
          yield* tests.setLinearId(resultIds[1], "LST-102");
          yield* tests.setLinearId(resultIds[2], "LST-103");
          yield* tests.setLinearId(resultIds[3], "LST-104");
          yield* tests.setLinearId(resultIds[4], "LST-105");
          yield* tests.setLinearId(resultIds[5], "LST-106");
          const completedDrive = yield* automation.enqueue({
            resultId: resultIds[0],
            action: "drive",
          });
          const completedDiagnose = yield* automation.enqueue({
            resultId: resultIds[1],
            action: "diagnose",
          });
          yield* automation.enqueue({ resultId: resultIds[2], action: "drive" });
          yield* automation.enqueue({ resultId: resultIds[3], action: "diagnose" });
          yield* automation.enqueue({ resultId: resultIds[4], action: "drive" });
          yield* automation.enqueue({ resultId: resultIds[5], action: "diagnose" });
          expect(Option.isSome(yield* automation.claim(crypto.randomUUID()))).toBe(true);
          expect(Option.isSome(yield* automation.claim(crypto.randomUUID()))).toBe(true);
          yield* automation.finish(completedDrive.id, "succeeded", null);
          yield* automation.finish(completedDiagnose.id, "failed", "nope");
          yield* database.run("stamp", (db) =>
            db.execute(
              sql`update automation_jobs set finished_at = now() - interval '2 minutes' where id = ${completedDrive.id}`,
            ),
          );
          expect(Option.isSome(yield* automation.claim(crypto.randomUUID()))).toBe(true);
          expect(Option.isSome(yield* automation.claim(crypto.randomUUID()))).toBe(true);
          const listed = yield* automation.listJobs(1);
          expect(listed.running.map((job) => [job.ticket, job.action, job.status])).toEqual([
            ["LST-104", "diagnose", "running"],
            ["LST-103", "drive", "running"],
          ]);
          expect(listed.pending.map((job) => [job.ticket, job.action, job.test])).toEqual([
            ["LST-106", "diagnose", "lock-screen"],
            ["LST-105", "drive", "lock-screen"],
          ]);
          expect(listed.completed.map((job) => [job.ticket, job.status])).toEqual([
            ["LST-102", "failed"],
          ]);
          const more = yield* automation.listJobs(10);
          expect(more.completed.map((job) => job.ticket)).toEqual(["LST-102", "LST-101"]);
          expect(more.running).toHaveLength(2);
          expect(more.pending).toHaveLength(2);
        }),
    );

    scoped.effect(
      "ServerStore registers a url once as a qemu server, lists the qemu servers in registration order, forgets it",
      () =>
        Effect.gen(function* () {
          const store = yield* Servers.ServerStore;
          const database = yield* Client.Database;
          const first = `http://10.0.0.5:${uuid().slice(0, 8)}`;
          const second = `http://10.0.0.6:${uuid().slice(0, 8)}`;
          yield* store.addServer(first, "qemu");
          yield* store.addServer(second, "qemu");
          yield* store.addServer(first, "qemu");
          const [row] = yield* database.run("select", (db) =>
            db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, first)),
          );
          expect(row).toMatchObject({ url: first, type: "qemu", stats: null, generation: 0 });
          const listed = yield* store.listServers("qemu");
          expect(listed.filter((url) => url === first || url === second)).toEqual([first, second]);
          expect(yield* store.removeServer(first)).toBe(true);
          expect(yield* store.removeServer(first)).toBe(false);
          expect(yield* store.listServers("qemu")).not.toContain(first);
          expect(yield* store.listServers("qemu")).toContain(second);
          expect(yield* store.removeServer(second)).toBe(true);
          expect(yield* store.listServers("qemu")).not.toContain(second);
        }),
    );

    // The column's default is what the migration filled the rows that predate it with: a row
    // written without a type is a qemu server, the only kind there was.
    scoped.effect("a servers row written without a type is a qemu server", () =>
      Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        const database = yield* Client.Database;
        const url = `http://10.0.0.9:${uuid().slice(0, 8)}`;
        yield* database.run("insert", (db) => db.insert(DbSchema.servers).values({ url }));
        const [row] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
        );
        expect(row).toMatchObject({ url, type: "qemu" });
        expect(yield* store.listServers("qemu")).toContain(url);
        expect(yield* store.removeServer(url)).toBe(true);
      }),
    );

    scoped.effect("the table refuses a server type outside the enum (unhappy)", () =>
      Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        const database = yield* Client.Database;
        const url = `http://10.0.0.10:${uuid().slice(0, 8)}`;
        const error = yield* Effect.flip(
          database.run("insert", (db) =>
            db.insert(DbSchema.servers).values({ url, type: sql`'docker'` }),
          ),
        );
        expect(error).toMatchObject({
          _tag: "DatabaseError",
          operation: "insert",
          message: expect.stringContaining("Failed query"),
        });
        expect(String(error.cause)).toMatch(/invalid input value for enum server_type/);
        expect(yield* store.listServers("qemu")).not.toContain(url);
      }),
    );

    scoped.effect(
      "ServerStore heartbeat announces a qemu server: generation 1 on the first write, then counting up with the stats rewritten",
      () =>
        Effect.gen(function* () {
          const store = yield* Servers.ServerStore;
          const database = yield* Client.Database;
          const url = `http://10.0.0.7:${uuid().slice(0, 8)}`;
          const first: DbSchema.ServerStats = {
            qemus: 1,
            memory: { totalBytes: 16_000, usedBytes: 4_000 },
            cpu: { mean1m: 22.3, mean2m: 21.4, mean3m: 20.9 },
          };
          const rowOf = database.run("select", (db) =>
            db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
          );
          yield* store.heartbeat(url, "qemu", first);
          expect(yield* store.listServers("qemu")).toContain(url);
          const [row] = yield* rowOf;
          expect(row).toMatchObject({ url, type: "qemu", stats: first, generation: 1 });
          expect(row?.heartbeatAt).toBeInstanceOf(Date);
          const second: DbSchema.ServerStats = { ...first, qemus: 2 };
          yield* store.heartbeat(url, "qemu", second);
          const rows = yield* rowOf;
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ url, type: "qemu", stats: second, generation: 2 });
          expect(rows[0]?.heartbeatAt?.getTime()).toBeGreaterThanOrEqual(
            row?.heartbeatAt?.getTime() ?? Number.POSITIVE_INFINITY,
          );
          expect(yield* store.removeServer(url)).toBe(true);
        }),
    );

    scoped.effect(
      "ServerStore heartbeat fills the row an operator added: still one row, generation 1",
      () =>
        Effect.gen(function* () {
          const store = yield* Servers.ServerStore;
          const database = yield* Client.Database;
          const url = `http://10.0.0.8:${uuid().slice(0, 8)}`;
          const rowOf = database.run("select", (db) =>
            db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
          );
          yield* store.addServer(url, "qemu");
          const [added] = yield* rowOf;
          expect(added).toMatchObject({
            url,
            type: "qemu",
            stats: null,
            generation: 0,
            heartbeatAt: null,
          });
          const stats: DbSchema.ServerStats = {
            qemus: 0,
            memory: { totalBytes: 66_900_000_000, usedBytes: 31_500_000_000 },
            cpu: { mean1m: 12.3, mean2m: 11, mean3m: 9.8 },
          };
          yield* store.heartbeat(url, "qemu", stats);
          const rows = yield* rowOf;
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ url, type: "qemu", stats, generation: 1 });
          expect(rows[0]?.heartbeatAt).toBeInstanceOf(Date);
          expect(yield* store.removeServer(url)).toBe(true);
        }),
    );

    scoped.effect(
      "ServerStore heartbeat as an automation-client writes its own kind and generation",
      () =>
        Effect.gen(function* () {
          const store = yield* Servers.ServerStore;
          const database = yield* Client.Database;
          const url = `http://10.0.0.11:${uuid().slice(0, 8)}`;
          const first: DbSchema.ServerStats = {
            qemus: 0,
            memory: { totalBytes: 8_000_000_000, usedBytes: 2_000_000_000 },
            cpu: { mean1m: 4.1, mean2m: 3.8, mean3m: 3.2 },
          };
          const rowOf = database.run("select", (db) =>
            db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
          );
          yield* store.heartbeat(url, "automation-client", first);
          expect(yield* store.listServers("automation-client")).toContain(url);
          expect(yield* store.listServers("qemu")).not.toContain(url);
          const [row] = yield* rowOf;
          expect(row).toMatchObject({
            url,
            type: "automation-client",
            stats: first,
            generation: 1,
          });
          expect(row?.heartbeatAt).toBeInstanceOf(Date);
          const second: DbSchema.ServerStats = { ...first, cpu: { ...first.cpu, mean1m: 5 } };
          yield* store.heartbeat(url, "automation-client", second);
          const rows = yield* rowOf;
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            url,
            type: "automation-client",
            stats: second,
            generation: 2,
          });
          expect(yield* store.removeServer(url)).toBe(true);
        }),
    );

    scoped.effect("ServerStore registers a url once as an automation-client", () =>
      Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        const database = yield* Client.Database;
        const url = `http://10.0.0.12:${uuid().slice(0, 8)}`;
        yield* store.addServer(url, "automation-client");
        yield* store.addServer(url, "automation-client");
        const [row] = yield* database.run("select", (db) =>
          db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
        );
        expect(row).toMatchObject({
          url,
          type: "automation-client",
          stats: null,
          generation: 0,
        });
        expect(yield* store.listServers("automation-client")).toContain(url);
        expect(yield* store.listServers("qemu")).not.toContain(url);
        expect(yield* store.removeServer(url)).toBe(true);
      }),
    );

    scoped.effect(
      "ServerStore listLiveServers keeps a 44s heartbeat and drops a 46s one, the wrong type, and a null heartbeat",
      () =>
        Effect.gen(function* () {
          const store = yield* Servers.ServerStore;
          const database = yield* Client.Database;
          const stats: DbSchema.ServerStats = {
            qemus: 0,
            memory: { totalBytes: 1, usedBytes: 0 },
            cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
          };
          const fresh = `http://10.0.0.20:${uuid().slice(0, 8)}`;
          const stale = `http://10.0.0.21:${uuid().slice(0, 8)}`;
          const qemu = `http://10.0.0.22:${uuid().slice(0, 8)}`;
          const silent = `http://10.0.0.23:${uuid().slice(0, 8)}`;
          yield* store.heartbeat(fresh, "automation-client", stats);
          yield* store.heartbeat(stale, "automation-client", stats);
          yield* store.heartbeat(qemu, "qemu", stats);
          yield* store.addServer(silent, "automation-client");
          yield* database.run("stamp", (db) =>
            db
              .update(DbSchema.servers)
              .set({ heartbeatAt: sql`now() - interval '44 seconds'` })
              .where(eq(DbSchema.servers.url, fresh)),
          );
          yield* database.run("stamp", (db) =>
            db
              .update(DbSchema.servers)
              .set({ heartbeatAt: sql`now() - interval '46 seconds'` })
              .where(eq(DbSchema.servers.url, stale)),
          );
          const live = yield* store.listLiveServers("automation-client");
          expect(live.map((server) => server.url)).toEqual([fresh]);
          expect(live[0]?.id).toEqual(expect.any(String));
          expect(yield* store.findServer(live[0]?.id ?? "")).toEqual(Option.some(live[0]));
          expect(yield* store.findServer(crypto.randomUUID())).toEqual(Option.none());
          expect(yield* store.listServers("automation-client")).toEqual(
            expect.arrayContaining([fresh, stale, silent]),
          );
          expect(yield* store.removeServer(fresh)).toBe(true);
          expect(yield* store.removeServer(stale)).toBe(true);
          expect(yield* store.removeServer(qemu)).toBe(true);
          expect(yield* store.removeServer(silent)).toBe(true);
        }),
    );

    scoped.effect("ProcessStatsStore reports a qemu process once, then rewrites the reading", () =>
      Effect.gen(function* () {
        const servers = yield* Servers.ServerStore;
        const store = yield* ProcessStats.ProcessStatsStore;
        const database = yield* Client.Database;
        const url = `http://10.0.0.30:${uuid().slice(0, 8)}`;
        const first: DbSchema.ProcessStats = { jobs: 1, memoryBytes: 4_096_000, cpuPercent: 12.5 };
        const second: DbSchema.ProcessStats = { jobs: 3, memoryBytes: 8_192_000, cpuPercent: 40 };
        yield* servers.heartbeat(url, "qemu", {
          qemus: 1,
          memory: { totalBytes: 1, usedBytes: 0 },
          cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
        });
        const rowOf = database.run("select", (db) =>
          db.select().from(DbSchema.processStats).where(eq(DbSchema.processStats.url, url)),
        );
        yield* store.report(url, "qemu", first);
        const [row] = yield* rowOf;
        expect(row).toMatchObject({ url, type: "qemu", ...first });
        expect(row?.reportedAt).toBeInstanceOf(Date);
        yield* store.report(url, "qemu", second);
        const rows = yield* rowOf;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ url, type: "qemu", ...second });
        expect(rows[0]?.reportedAt.getTime()).toBeGreaterThanOrEqual(
          row?.reportedAt.getTime() ?? Number.POSITIVE_INFINITY,
        );
        expect(yield* store.remove(url)).toBe(true);
        expect(yield* rowOf).toEqual([]);
        expect(yield* servers.removeServer(url)).toBe(true);
      }),
    );

    scoped.effect(
      "ProcessStatsStore reports an automation-client, and deleting the servers row cascades the reading",
      () =>
        Effect.gen(function* () {
          const servers = yield* Servers.ServerStore;
          const store = yield* ProcessStats.ProcessStatsStore;
          const database = yield* Client.Database;
          const url = `http://10.0.0.31:${uuid().slice(0, 8)}`;
          yield* servers.heartbeat(url, "automation-client", {
            qemus: 0,
            memory: { totalBytes: 1, usedBytes: 0 },
            cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
          });
          yield* store.report(url, "automation-client", {
            jobs: 2,
            memoryBytes: 1_000,
            cpuPercent: 5,
          });
          expect(yield* servers.removeServer(url)).toBe(true);
          const rows = yield* database.run("select", (db) =>
            db.select().from(DbSchema.processStats).where(eq(DbSchema.processStats.url, url)),
          );
          expect(rows).toEqual([]);
          expect(yield* store.remove(url)).toBe(false);
        }),
    );

    scoped.effect(
      "ProcessStatsStore refuses a report before the servers row exists (unhappy)",
      () =>
        Effect.gen(function* () {
          const store = yield* ProcessStats.ProcessStatsStore;
          const url = `http://10.0.0.32:${uuid().slice(0, 8)}`;
          const error = yield* Effect.flip(
            store.report(url, "qemu", { jobs: 0, memoryBytes: 1, cpuPercent: 0 }),
          );
          expect(error).toMatchObject({ _tag: "DatabaseError", operation: "reportProcess" });
          expect(String(error.cause)).toContain("foreign key");
        }),
    );

    scoped.effect("ServerStore routes a session once and answers where it went", () =>
      Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        const sessions = yield* Sessions.SessionStore;
        const id = uuid();
        yield* sessions.insertSession(id, { iso: "x" }, "running");
        expect(yield* store.serverForSession(id)).toEqual(Option.none());
        yield* store.routeSession(id, "http://10.0.0.5:42069");
        expect(yield* store.serverForSession(id)).toEqual(Option.some("http://10.0.0.5:42069"));
        // The route outlives the server's registration: forgetting a server keeps its sessions.
        expect(yield* store.serverForSession(id.toUpperCase())).toEqual(
          Option.some("http://10.0.0.5:42069"),
        );
        const twice = yield* Effect.flip(store.routeSession(id, "http://10.0.0.6:42069"));
        expect(twice).toMatchObject({ _tag: "DatabaseError", operation: "routeSession" });
        expect(String(twice.cause)).toContain("duplicate key");
        expect(yield* store.serverForSession(id)).toEqual(Option.some("http://10.0.0.5:42069"));
      }),
    );

    scoped.effect("ServerStore routes an agent once and answers where it went", () =>
      Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        expect(yield* store.serverForAgent("OLI-61")).toEqual(Option.none());
        yield* store.routeAgent("OLI-61", "http://10.0.0.5:42069");
        expect(yield* store.serverForAgent("OLI-61")).toEqual(Option.some("http://10.0.0.5:42069"));
        yield* store.routeAgent("OLI-61", "http://10.0.0.6:42069");
        expect(yield* store.serverForAgent("OLI-61")).toEqual(Option.some("http://10.0.0.5:42069"));
        yield* store.clearAgent("OLI-61");
        expect(yield* store.serverForAgent("OLI-61")).toEqual(Option.none());
      }),
    );

    scoped.effect("ServerStore refuses a route for a session that does not exist (unhappy)", () =>
      Effect.gen(function* () {
        const store = yield* Servers.ServerStore;
        const error = yield* Effect.flip(store.routeSession(uuid(), "http://10.0.0.5:42069"));
        expect(error).toMatchObject({ _tag: "DatabaseError", operation: "routeSession" });
        expect(String(error.cause)).toContain("foreign key");
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
