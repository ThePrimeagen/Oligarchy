import {
  Cause,
  Context,
  Effect,
  Exit,
  type FileSystem,
  Layer,
  Option,
  Ref,
  type Scope,
} from "effect";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import type * as Tests from "@oligarchy/db/tests";
import * as Open from "@oligarchy/jobs/open";
import type * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";

// Not a heartbeat. The loop exists only while a setup is still in flight, and a tick is this
// far apart. It does not have to land on the second.
export const CHECK_INTERVAL = "30 seconds";

export type Decision = "gone" | "keep" | "release" | "done";

// The row was read just now. gone: it is not there (a server that came back deleted it).
// done: the result passed; the row stays and we stop watching it. release: the setup ended
// without a pass (a completed install nobody judged may not have saved) or never got a result,
// so the row goes and a later 409 may try again. keep: still in flight.
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
    case "errored":
    case "aborted":
    case "timed_out":
    case "completed":
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
    case "completed":
    case "errored":
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
    const log = yield* Log.Log;
    // What Jobs.openMint needs, captured once, so open asks nothing of the request that calls it.
    const context = yield* Effect.context<
      | SetupRequests.SetupRequestStore
      | Tests.TestStore
      | Linear.Linear
      | Log.Log
      | FileSystem.FileSystem
    >();
    // Filled by install, which runs in the server scope. A request's scope must not own the loop.
    let scope: Scope.Scope | null = null;
    const gate = yield* Ref.make<Gate>({ on: false, again: false });
    // A create still talking to Linear holds its lock. The check treats a missing result as a
    // dead ticket, and that check was deleting the row out from under the create, which then
    // queued the job anyway and let the next reserve mint the server again.
    const creating = yield* Ref.make<ReadonlySet<string>>(new Set());
    const keyOf = (iso: string, serverUrl: string): string => `${iso}\n${serverUrl}`;
    const hold = (iso: string, serverUrl: string) =>
      Ref.update(creating, (current) => new Set(current).add(keyOf(iso, serverUrl)));
    const dropHold = (iso: string, serverUrl: string) =>
      Ref.update(creating, (current) => {
        const next = new Set(current);
        next.delete(keyOf(iso, serverUrl));
        return next;
      });

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
        // 3. The mint job and its ticket, pinned to this server on the lock before the ticket
        // reaches Automation Needed. A failure has already failed the run, naming any ticket
        // left in Backlog, and a lock deleted meanwhile is one of them.
        // A failed ticket calls drop, which deletes the row. If that delete fails, drop
        // logs `setup release failed` through log.error. That line is reported to Sentry,
        // because it does not set skipSentry, and the delete's own cause is not attached.
        // Then we return. The row is still there, with no result id.
        // What happens after that is the open question, and it is not changed here. The 30s
        // check treats a missing result as release and tries the delete again. A later reserve
        // sees the row and does not create another ticket. An issue createIssue already made,
        // before a later step failed, is not reconciled. A delete that keeps failing leaves
        // the server locked.
        const exit = yield* Effect.exit(
          Open.openMint({ iso, serverUrl: proxyUrl, pinned: serverUrl }).pipe(
            Effect.provideContext(context),
          ),
        );
        if (Exit.isFailure(exit)) {
          yield* drop(iso, serverUrl, Render.errorDetail(Cause.squash(exit.cause)));
          return;
        }
        // 4. The issue exists and the lock names its result: watch it.
        yield* log.info(`setup ticket ${exit.value.linear.identifier}; ${serverUrl}; ${iso}`, {
          location: Log.Locations.server,
        });
        yield* arm;
      });

    const begin = (iso: string, serverUrl: string, proxyUrl: string) =>
      hold(iso, serverUrl).pipe(
        Effect.andThen(create(iso, serverUrl, proxyUrl)),
        Effect.ensuring(dropHold(iso, serverUrl)),
      );

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
        if (
          action === "release" &&
          Option.isSome(fresh) &&
          fresh.value.resultId === null &&
          (yield* Ref.get(creating)).has(keyOf(key.iso, key.serverUrl))
        ) {
          keep = true;
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
      // 1. The row is the lock, one per iso and server. 2. Only a won insert continues.
      // A lost insert, or an insert that failed, does not create a ticket.
      if (inserted) {
        yield* begin(iso, serverUrl, proxyUrl);
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
          yield* begin(iso, serverUrl, proxyUrl);
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
        yield* begin(iso, serverUrl, proxyUrl);
      }
    });

    return { open, install };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
