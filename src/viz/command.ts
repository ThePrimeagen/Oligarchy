import { Effect, Layer, type Redacted, Terminal } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Config from "../config.ts";
import * as EnvFile from "../env-file.ts";
import * as Actions from "../db/actions.ts";
import * as Automation from "../db/automation.ts";
import * as Client from "../db/client.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as Tests from "../db/tests.ts";
import * as Errors from "../shared/errors.ts";
import * as Run from "./run.ts";
import * as View from "./view.ts";

export type Stores =
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Automation.AutomationStore
  | Actions.ActionStore
  | Tests.TestStore;

// viz reads the database alone: the machines, their readings and the queue. What it changes, an
// abort, goes through the automation server.
export type Deps = {
  readonly database: (url: Redacted.Redacted) => Layer.Layer<Stores, Errors.DatabaseError>;
};

export const live: Deps = {
  database: (url) =>
    Layer.mergeAll(
      Servers.ServerStore.layer,
      ProcessStats.ProcessStatsStore.layer,
      Automation.AutomationStore.layer,
      Actions.ActionStore.layer,
      Tests.TestStore.layer,
    ).pipe(Layer.provide(Client.Database.layer(url))),
};

export const makeVizCommand = (deps: Deps = live) => {
  const withDb = Layer.unwrap(Effect.map(Config.databaseUrl, (url) => deps.database(url)));

  // DATABASE_URL is wanted first (the layer), the terminal second, the screen and the first
  // read last, so a refused terminal never sees the alternate screen.
  return Command.make(
    "viz",
    {},
    Effect.fn("viz")(function* () {
      const terminal = yield* Terminal.Terminal;
      const columns = yield* terminal.columns;
      const rows = yield* terminal.rows;
      // A pipe has no size.
      if (columns === 0 || rows === 0) {
        return yield* Errors.CommandError.make({ message: "viz needs a terminal" });
      }
      if (columns < View.MIN_COLUMNS || rows < View.MIN_ROWS) {
        return yield* Errors.CommandError.make({ message: View.tooSmall(columns, rows) });
      }
      return yield* Run.run;
    }),
  ).pipe(
    Command.withDescription(
      "Watch the automation clients, the qemu servers and the tickets in the terminal. It opens on automation: each client and the jobs it runs, beside that client's memory and cpu over the last five minutes, and the selected ticket's session in the rest of the main area. On a ticket that pane is the current ActionList step and the actions under it, and a running row shows the step as n/total. j and k rest on a ticket. s, t and h/l switch tabs; the qemu tab keeps each server as a card with the running and pending jobs below, and the tickets tab lists those plus the newest finished. j/k select, tab moves between the machines and the queue on the qemu tab, d opens the selected ticket's test definition, enter shows the ticket, L opens the selected job's Linear ticket in the browser, F follows the selected running job, waiting for its session if the guest has not started, a asks, then aborts the selected job at the automation server (AUTOMATION_SERVER_URL, with OLIGARCHY_TOKEN), q quits",
    ),
    Command.provide(withDb),
    EnvFile.withEnvFile,
  );
};
