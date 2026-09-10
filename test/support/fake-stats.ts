import { Effect, Layer } from "effect";
import * as Stats from "../../src/host/stats.ts";
import * as Contract from "../../src/shared/contract.ts";

export const ZERO_STATS: Stats.HostStats = {
  memory: Contract.Memory.make({ totalBytes: 0, usedBytes: 0, freeBytes: 0 }),
  cpu: Contract.Cpu.make({
    cores: 0,
    mean: 0,
    mean1m: 0,
    mean2m: 0,
    mean3m: 0,
    p10: 0,
    p25: 0,
    p75: 0,
    p90: 0,
  }),
};

// Stats that report fixed host readings; the caller composes the count.
export const fakeStats: Layer.Layer<Stats.Stats> = Layer.succeed(Stats.Stats)(
  Stats.Stats.of({
    collect: Effect.succeed(ZERO_STATS),
  }),
);
