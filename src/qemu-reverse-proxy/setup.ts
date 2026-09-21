import { Cause, Context, Effect, Exit, FileSystem, Layer, Option, Ref, type Scope } from "effect";
import * as Linear from "../ctrl/linear.ts";
import * as Prompts from "../ctrl/prompts.ts";
import * as SetupRequests from "../db/setup-requests.ts";
import * as Tests from "../db/tests.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";

// The install ./ctrl mint already uses. One definition, one ticket pinned to the server.
const MINT_DEFINITION = "mint";
const MINT_LABEL = "mint";

// Not a heartbeat. The loop exists only while a setup is still in flight, and a tick is this
// far apart. It does not have to land on the second.
export const CHECK_INTERVAL = "30 seconds";

export type Decision = "gone" | "keep" | "release" | "done";

// The row was read just now. gone: it is not there (a server that came back deleted it).
// done: the result passed; the row stays and we stop watching it. release: the setup failed
// or never got a result, so the row goes and a later 409 may try again. keep: still in flight.
export const decide = (fresh: Option.Option<SetupRequests.Situation>): Decision => {
  if (Option.isNone(fresh)) {
    return "gone";
  }
  const row = fresh.value;
  // No result id yet: the ticket was never attached. A stored id whose result row is gone was
  // swept; the lock stays, or a later 409 would mint the server again.
  if (row.resultId === null) {
    return "release";
  }
  if (row.resultStatus === null) {
    return "done";
  }
  switch (row.resultStatus) {
    case "passed":
      return "done";
    case "failed":
    case "aborted":
    case "timed_out":
      return "release";
    case "pending":
    case "running":
      break;
  }
  switch (row.driveStatus) {
    case null:
    case "pending":
    case "running":
      return "keep";
    case "succeeded":
    case "failed":
    case "aborted":
    case "timed_out":
      return "release";
  }
  return "keep";
};

// The host that asked, as the ticket's SERVER_URL: what ./client will call. Absent is a reserve
// that carried no host, and a ticket from it would name nothing a driver can reach.
export const proxyOrigin = (headers: { readonly [name: string]: string | undefined }): string => {
  const host = headers["host"];
  if (host === undefined || host === "") {
    return "";
  }
  return headers["x-forwarded-proto"] === "https" ? `https://${host}` : `http://${host}`;
};

type Gate = { readonly on: boolean; readonly again: boolean };

export class Setup extends Context.Service<Setup>()("@oligarchy/qemu-reverse-proxy/Setup", {
  make: Effect.gen(function* () {
    const store = yield* SetupRequests.SetupRequestStore;
    const tests = yield* Tests.TestStore;
    const linear = yield* Linear.Linear;
    const fs = yield* FileSystem.FileSystem;
    const log = yield* Log.Log;
    // Filled by install, which runs in the server scope. A request's scope must not own the loop.
    let scope: Scope.Scope | null = null;
    const gate = yield* Ref.make<Gate>({ on: false, again: false });

    const logged = (text: string) => log.error(text, { location: Log.Locations.server });

    const release = (iso: string, serverUrl: string, why: string) =>
      store.remove(iso, serverUrl).pipe(
        Effect.andThen(
          log.info(`setup released; ${serverUrl}; ${iso}; ${why}`, {
            location: Log.Locations.server,
          }),
        ),
      );

    const drop = (iso: string, serverUrl: string, why: string) =>
      store.remove(iso, serverUrl).pipe(
        Effect.andThen(logged(`setup ticket failed: ${why}; ${serverUrl}; ${iso}`)),
        Effect.catchCause((cause) =>
          logged(
            `setup release failed; ${serverUrl}; ${iso}: ${Render.errorDetail(Cause.squash(cause))}`,
          ),
        ),
      );

    // One mint ticket for this server, as ./ctrl mint writes one: a run, a result, a Linear
    // issue born in Backlog and moved to Automation Needed with its body.
    const ticket = Effect.fn("Setup.ticket")(function* (
      iso: string,
      serverUrl: string,
      proxyUrl: string,
    ) {
      const definition = yield* tests.findTestDefinition(MINT_DEFINITION);
      if (Option.isNone(definition)) {
        return yield* Effect.fail({
          message: `setup: no test definition named ${MINT_DEFINITION}; define the install once with ./ctrl test define --name ${MINT_DEFINITION}`,
        });
      }
      const created = yield* tests.createRun({
        iso,
        serverUrl: proxyUrl,
        definitions: [definition.value],
      });
      const result = created.results[0];
      if (result === undefined) {
        return yield* Effect.die(new Error(`setup: run ${created.runId} has no result`));
      }
      const resultId = result.id;
      const issued = yield* Effect.gen(function* () {
        const client = yield* Linear.Linear;
        const teamId = yield* client.teamId;
        const labelIds = yield* client.labelIds(teamId, MINT_LABEL);
        const assigneeId = yield* client.assigneeId;
        const states = yield* client.stateIds(teamId);
        const issue = yield* client.createIssue({
          teamId,
          title: `Omarchy mint: ${serverUrl}`,
          labelIds,
          assigneeId,
          stateId: states.backlog,
        });
        yield* tests.setLinearId(resultId, issue.identifier);
        const description = yield* Prompts.renderMintIssue({
          LINEAR_TICKET: issue.identifier,
          RUN_ID: created.runId,
          RESULT_ID: resultId,
          ISO_URL: iso,
          SERVER_URL: proxyUrl,
          PINNED_SERVER: serverUrl,
          INSTALL_NAME: definition.value.name,
          INSTALL_DESCRIPTION: definition.value.description,
          INSTALL_INSTRUCTION: definition.value.instruction,
          INSTALL_PROOF: definition.value.proof,
        });
        yield* client.describeIssue(issue, description, states.automationNeeded);
        return issue;
      }).pipe(
        Effect.provideService(Linear.Linear, linear),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.catch((error) =>
          tests.failRun(created.runId, Render.errorDetail(error)).pipe(
            // The create already failed. Failing the run records it; that second failure is
            // logged and the first error is what drops the lock.
            Effect.catchCause((cause) =>
              logged(
                `setup failRun failed; ${created.runId}: ${Render.errorDetail(Cause.squash(cause))}`,
              ),
            ),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
      return { runId: created.runId, resultId, identifier: issued.identifier };
    });

    const arm = Effect.uninterruptible(
      Effect.gen(function* () {
        if (scope === null) {
          return;
        }
        const launch = yield* Ref.modify(gate, (current) =>
          current.on
            ? ([false, { on: true, again: true }] as const)
            : ([true, { on: true, again: false }] as const),
        );
        if (launch) {
          yield* Effect.forkIn(loop, scope);
        }
      }),
    );

    const create = (iso: string, serverUrl: string, proxyUrl: string) =>
      Effect.gen(function* () {
        if (proxyUrl === "") {
          yield* drop(iso, serverUrl, "reserve carried no host");
          return;
        }
        const exit = yield* Effect.exit(ticket(iso, serverUrl, proxyUrl));
        if (Exit.isFailure(exit)) {
          yield* drop(iso, serverUrl, Render.errorDetail(Cause.squash(exit.cause)));
          return;
        }
        const stored = yield* Effect.exit(store.setResult(iso, serverUrl, exit.value.resultId));
        if (Exit.isFailure(stored)) {
          yield* drop(
            iso,
            serverUrl,
            `result not stored: ${Render.errorDetail(Cause.squash(stored.cause))}`,
          );
          return;
        }
        if (!stored.value) {
          yield* tests
            .failRun(exit.value.runId, "setup row gone before its result was stored")
            .pipe(
              Effect.catchCause((cause) =>
                logged(
                  `setup failRun failed; ${exit.value.runId}: ${Render.errorDetail(Cause.squash(cause))}`,
                ),
              ),
            );
          yield* log.info(`setup gone; ${serverUrl}; ${iso}`, { location: Log.Locations.server });
          return;
        }
        yield* log.info(`setup ticket ${exit.value.identifier}; ${serverUrl}; ${iso}`, {
          location: Log.Locations.server,
        });
        yield* arm;
      });

    const tick = Effect.gen(function* () {
      const rows = yield* store.list();
      let keep = false;
      for (const key of rows) {
        // Read it again. A server that came back has already deleted the row; the status we
        // would have acted on is gone with it.
        const fresh = yield* store.inspect(key.iso, key.serverUrl);
        const action = decide(fresh);
        if (action === "keep") {
          keep = true;
          continue;
        }
        if (action === "gone") {
          yield* log.info(`setup gone; ${key.serverUrl}; ${key.iso}`, {
            location: Log.Locations.server,
          });
          continue;
        }
        if (action === "release" && Option.isSome(fresh)) {
          // A delete that fails is still in flight: the timer stays up and tries next interval.
          const deleted = yield* release(
            key.iso,
            key.serverUrl,
            fresh.value.resultStatus ?? "no result",
          ).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              logged(
                `setup release failed; ${key.serverUrl}; ${key.iso}: ${Render.errorDetail(Cause.squash(cause))}`,
              ).pipe(Effect.as(false)),
            ),
          );
          if (!deleted) {
            keep = true;
          }
        }
      }
      return keep;
    }).pipe(
      Effect.catchCause((cause) =>
        logged(`setup check failed: ${Render.errorDetail(Cause.squash(cause))}`).pipe(
          Effect.as(true),
        ),
      ),
    );

    const loop = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(CHECK_INTERVAL);
        if (yield* tick) {
          continue;
        }
        const again = yield* Ref.modify(gate, (current) =>
          current.again
            ? ([true, { on: true, again: false }] as const)
            : ([false, { on: false, again: false }] as const),
        );
        if (!again) {
          return;
        }
      }
    });

    const install = Effect.fn("Setup.install")(function* () {
      scope = yield* Effect.scope;
      const rows = yield* store.list();
      for (const key of rows) {
        const fresh = yield* store.inspect(key.iso, key.serverUrl);
        const action = decide(fresh);
        if (action === "keep" || action === "release") {
          yield* arm;
          return;
        }
      }
    });

    const open = Effect.fn("Setup.open")(function* (
      iso: string,
      serverUrl: string,
      proxyUrl: string,
    ) {
      const inserted = yield* store
        .insert(iso, serverUrl)
        .pipe(
          Effect.catchCause((cause) =>
            logged(
              `setup insert failed; ${serverUrl}; ${iso}: ${Render.errorDetail(Cause.squash(cause))}`,
            ).pipe(Effect.as(false)),
          ),
        );
      if (inserted) {
        yield* create(iso, serverUrl, proxyUrl);
        return;
      }
      const fresh = yield* store
        .inspect(iso, serverUrl)
        .pipe(
          Effect.catchCause((cause) =>
            logged(
              `setup inspect failed; ${serverUrl}; ${iso}: ${Render.errorDetail(Cause.squash(cause))}`,
            ).pipe(Effect.as(Option.none())),
          ),
        );
      // A null result is a create still in this process, or one that died. Leave it for the
      // timer rather than deleting a lock the other open is writing.
      if (Option.isSome(fresh) && fresh.value.resultId === null) {
        yield* arm;
        return;
      }
      const action = decide(fresh);
      if (action === "keep" || action === "done") {
        if (action === "keep") {
          yield* arm;
        }
        return;
      }
      if (action === "gone") {
        const again = yield* store.insert(iso, serverUrl).pipe(Effect.orElseSucceed(() => false));
        if (again) {
          yield* create(iso, serverUrl, proxyUrl);
        }
        return;
      }
      // Best-effort: the row may already be gone. The insert that follows takes the lock.
      yield* store
        .remove(iso, serverUrl)
        .pipe(
          Effect.catchCause((cause) =>
            logged(
              `setup release failed; ${serverUrl}; ${iso}: ${Render.errorDetail(Cause.squash(cause))}`,
            ),
          ),
        );
      const again = yield* store.insert(iso, serverUrl).pipe(Effect.orElseSucceed(() => false));
      if (again) {
        yield* create(iso, serverUrl, proxyUrl);
      }
    });

    return { open, install };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
