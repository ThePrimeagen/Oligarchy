import * as Async from "@oligarchy/async";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { attempt } from "./failure.ts";
import type * as Host from "./host.ts";
import type * as Usage from "./usage.ts";

// The dashboard polls as often, so a row is never more than one poll behind.
export const HEARTBEAT_MS = 30_000;

type Refusal = { readonly message: string };

export type Member = {
  readonly type: Stores.Servers.ServerType;
  readonly url: string;
  readonly name: string;
  readonly attribution: Logger.Attribution;
  readonly report: (
    signal: AbortSignal,
  ) => Promise<jarl.Result<{ readonly qemus: number; readonly jobs: number }, Refusal>>;
  readonly onJoin?: (signal: AbortSignal) => Promise<jarl.Result<void, Refusal>>;
  readonly onLeave?: () => Promise<jarl.Result<void, Refusal>>;
};

export type Needs = {
  readonly host: Pick<Host.Host, "collect">;
  readonly usage: Pick<Usage.Usage, "collect">;
  readonly servers: Pick<Stores.Servers.Servers, "heartbeat" | "removeServer">;
  readonly processStats: Pick<Stores.ProcessStats.ProcessStats, "report">;
  readonly logger: Logger.Logger;
};

// Announces member: its servers row is written now and every heartbeat with its guests and the
// host's stats, and each tick adds a process_stats row of its jobs and this process's usage. Each
// failure is one error line under the member's attribution. A failed join or write leaves the
// rest of the tick to run, a failed report leaves nothing to write, and the next tick runs either
// way; a join is tried each tick until it succeeds. Once signal aborts and the tick in flight has
// finished, it leaves and deletes the servers row; the readings stay so they can be graphed.
export const announce = async (
  member: Member,
  needs: Needs,
  signal: AbortSignal,
  options: { readonly every?: number } = {},
): Promise<void> => {
  const { host, usage, servers, processStats } = needs;
  const log = { logger: needs.logger, attribution: member.attribution };
  const { onJoin, onLeave } = member;
  let joined = onJoin === undefined;

  const tick = async (tickSignal: AbortSignal) => {
    if (!joined && onJoin !== undefined) {
      joined = (await attempt(log, "join failed", () => onJoin(tickSignal))).ok;
    }
    const counts = await attempt(log, "report failed", () => member.report(tickSignal));
    if (!counts.ok) {
      return;
    }
    const { qemus, jobs } = jarl.value(counts);
    await attempt(log, "heartbeat failed", () => {
      const stats = host.collect();
      return servers.heartbeat(member.url, member.type, member.name, {
        qemus,
        memory: { totalBytes: stats.memory.totalBytes, usedBytes: stats.memory.usedBytes },
        cpu: { mean1m: stats.cpu.mean1m, mean2m: stats.cpu.mean2m, mean3m: stats.cpu.mean3m },
      });
    });
    await attempt(log, "process stats failed", async () => {
      const sample = await usage.collect();
      if (!sample.ok) {
        return sample;
      }
      return processStats.report(member.name, member.type, { jobs, ...jarl.value(sample) });
    });
  };

  await tick(signal);
  await Async.tick(tick, options.every ?? HEARTBEAT_MS, signal);
  if (onLeave !== undefined) {
    await attempt(log, "leave failed", onLeave);
  }
  await attempt(log, "unannounce failed", () => servers.removeServer(member.url));
};
