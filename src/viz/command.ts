import { Effect, Layer, type Redacted, Terminal } from "effect";
import { Command } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Automation from "../db/automation.ts";
import * as Client from "../db/client.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as Errors from "../shared/errors.ts";
import * as View from "./view.ts";

export type Stores =
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Automation.AutomationStore;

// viz only reads: the machines, their readings and the queue, straight from the database.
export type Deps = {
  readonly database: (url: Redacted.Redacted) => Layer.Layer<Stores, Errors.DatabaseError>;
};

export const live: Deps = {
  database: (url) =>
    Layer.mergeAll(
      Servers.ServerStore.layer,
      ProcessStats.ProcessStatsStore.layer,
      Automation.AutomationStore.layer,
    ).pipe(Layer.provide(Client.Database.layer(url))),
};

export const makeVizCommand = (deps: Deps = live) => {
  const withDb = Layer.unwrap(Effect.map(Config.databaseUrl, (url) => deps.database(url)));

  // DATABASE_URL is wanted first (the layer), the terminal second, the first read last.
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
      return yield* View.run;
    }),
  ).pipe(
    Command.withDescription(
      "Watch the qemu servers, the automation clients and the automation queue in the terminal, each machine a card with its cpu, memory and jobs graphed; j/k select a card, tab switches servers and clients, q quits",
    ),
    Command.provide(withDb),
  );
};
