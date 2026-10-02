import { readFileSync } from "node:fs";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Config from "../src/config.ts";
import * as Errors from "../src/errors.ts";
import * as Io from "../src/io.ts";

const valid = {
  models: {
    drive: "meta/muse-spark-1.3-contributor",
    diagnose: "meta/muse-spark-1.3-contributor",
    setup: "meta/muse-spark-1.3-contributor",
  },
  reasoning: { drive: "minimal", diagnose: "xhigh", setup: "minimal" },
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  httpTimeout: "10 seconds",
  fleet: {
    heartbeatInterval: "15 seconds",
    sampleInterval: "5 seconds",
    sampleLimit: 60,
    processTimeout: "10 seconds",
    processKillGrace: "1 second",
  },
  driver: {
    runCeiling: "1.5 hours",
    stepLimit: 200,
    askTimeout: "3 minutes",
    harness: { defaultRetry: "1 second", recentActions: 10 },
    guest: { startTimeout: "45 minutes", saveTimeout: "5 minutes", sendKeysTimeout: "30 seconds" },
  },
  diagnose: { runCeiling: "1.5 hours", headerTimeout: "3 minutes", chunkTimeout: "3 minutes" },
  automationClient: {
    driverGrace: "5 minutes",
    killGrace: "5 seconds",
    stderrGrace: "2 seconds",
    reserveTimeout: "1 minute",
    reservationTimeout: "2 minutes",
  },
  qemuServer: {
    probeTimeout: "3 seconds",
    reserveTimeout: "45 seconds",
    releaseTimeout: "30 seconds",
    setupInterval: "10 seconds",
    forgetInterval: "30 seconds",
    forgetAfter: "10 minutes",
    followTimeout: "1 hour",
  },
  qemuRunner: {
    reservationTimeout: "2 minutes",
    idleTimeout: "10 minutes",
    sweepInterval: "10 seconds",
    poweroffTimeout: "2 minutes",
    killGrace: "5 seconds",
    stderrGrace: "2 seconds",
    downloadTimeout: "40 minutes",
    cachePoll: "1 second",
    cacheStale: "2 minutes",
    cacheHeartbeat: "10 seconds",
    cacheProgress: "30 seconds",
    handshakeTimeout: "30 seconds",
    commandTimeout: "15 seconds",
    keyGap: "100 millis",
    clickGap: "100 millis",
    dragGap: "20 millis",
    dragSteps: 20,
    maxKeys: 10000,
    maxTicks: 100,
    followBacklog: 256,
    maxFrame: 1048576,
    stderrLimit: 1048576,
    cpus: 4,
    diskSize: "64G",
    memory: "4G",
    firmwareCode: "/usr/share/edk2/x64/OVMF_CODE.4m.fd",
    firmwareVars: "/usr/share/edk2/x64/OVMF_VARS.4m.fd",
    binary: "qemu-system-x86_64",
    imageBinary: "qemu-img",
  },
  automationServer: {
    dispatchInterval: "30 seconds",
    forgetInterval: "30 seconds",
    forgetAfter: "10 minutes",
    abortTimeout: "45 seconds",
  },
};

const loadText = (text: string) => Config.load(Io.fake({ files: { [Config.PATH]: text } }));

const refusal = async (file: object): Promise<string> => {
  const result = await loadText(JSON.stringify(file));
  if (!jarl.error.is(result, Errors.ConfigInvalid)) {
    throw new Error("expected ConfigInvalid");
  }
  return result.error.message;
};

describe("load", () => {
  it("refuses a heartbeat interval that reaches the runner expiry deadline", async () => {
    expect(
      await refusal({
        ...valid,
        fleet: { ...valid.fleet, heartbeatInterval: valid.qemuServer.forgetAfter },
      }),
    ).toContain("fleet.heartbeatInterval");
  });
  it("loads the checked-in oligarchy.json (happy)", async () => {
    expect(jarl.is_ok(await loadText(readFileSync(Config.PATH, "utf8")))).toBe(true);
  });

  it("turns every duration into milliseconds (happy)", async () => {
    const config = jarl.unwrap(await loadText(JSON.stringify(valid)));
    expect(config.httpTimeout).toBe(10_000);
    expect(config.driver).toEqual({
      runCeiling: 5_400_000,
      stepLimit: 200,
      askTimeout: 180_000,
      harness: { defaultRetry: 1_000, recentActions: 10 },
      guest: { startTimeout: 2_700_000, saveTimeout: 300_000, sendKeysTimeout: 30_000 },
    });
    expect(config.diagnose).toEqual({
      runCeiling: 5_400_000,
      headerTimeout: 180_000,
      chunkTimeout: 180_000,
    });
    expect(config.automationClient).toEqual({
      driverGrace: 300_000,
      killGrace: 5_000,
      stderrGrace: 2_000,
      reserveTimeout: 60_000,
      reservationTimeout: 120_000,
    });
    expect(config.automationServer.abortTimeout).toBe(45_000);
    expect(config.reasoning.diagnose).toBe("xhigh");
    expect(config.models.setup).toBe("meta/muse-spark-1.3-contributor");
    expect(config.reasoning.setup).toBe("minimal");
  });
  it("refuses a missing file rather than guessing a default (unhappy)", async () => {
    const result = await Config.load(Io.fake());
    if (!jarl.error.is(result, Errors.FileMissing)) {
      throw new Error("expected FileMissing");
    }
    expect(result.error.message).toBe(`${Config.PATH}: file is missing`);
  });

  it("refuses a file that cannot be read (unhappy)", async () => {
    const result = await Config.load(Io.fake({ unreadable: [Config.PATH] }));
    expect(jarl.error.is(result, Errors.FileUnreadable)).toBe(true);
  });

  it("refuses text that is not JSON, naming the file (unhappy)", async () => {
    const result = await loadText("{ not json");
    if (!jarl.error.is(result, Errors.ConfigInvalid)) {
      throw new Error("expected ConfigInvalid");
    }
    expect(result.error.message).toMatch(new RegExp(`^${Config.PATH}: `));
  });

  it("refuses a token key: the token stays in the environment (unhappy)", async () => {
    expect(await refusal({ ...valid, token: "sk-or-1" })).toContain("token");
  });

  it("names a field whose duration it cannot read (unhappy)", async () => {
    expect(await refusal({ ...valid, driver: { ...valid.driver, runCeiling: "soon" } })).toMatch(
      new RegExp(`^${Config.PATH}: driver.runCeiling: `),
    );
  });

  it("refuses a zero duration (unhappy)", async () => {
    const harness = { defaultRetry: "0 seconds", recentActions: 10 };
    expect(await refusal({ ...valid, driver: { ...valid.driver, harness } })).toBe(
      `${Config.PATH}: driver.harness.defaultRetry: duration must be greater than zero`,
    );
  });

  it("refuses a timeout that does not fit under its run ceiling (unhappy)", async () => {
    expect(await refusal({ ...valid, driver: { ...valid.driver, askTimeout: "2 hours" } })).toBe(
      `${Config.PATH}: driver.askTimeout: must be shorter than driver.runCeiling`,
    );
    expect(
      await refusal({ ...valid, diagnose: { ...valid.diagnose, chunkTimeout: "2 hours" } }),
    ).toBe(`${Config.PATH}: diagnose.chunkTimeout: must be shorter than diagnose.runCeiling`);
  });

  it("refuses an abort timeout too short for a client to stop its job (unhappy)", async () => {
    const automationServer = { ...valid.automationServer, abortTimeout: "7 seconds" };
    expect(await refusal({ ...valid, automationServer })).toBe(
      `${Config.PATH}: automationServer.abortTimeout: must be longer than automationClient.killGrace plus automationClient.stderrGrace, and than httpTimeout`,
    );
  });

  it("refuses a step limit below one (unhappy)", async () => {
    expect(await refusal({ ...valid, driver: { ...valid.driver, stepLimit: 0 } })).toBe(
      `${Config.PATH}: driver.stepLimit: stepLimit must be at least 1`,
    );
  });

  it("refuses a model that is not provider/model (unhappy)", async () => {
    expect(await refusal({ ...valid, models: { ...valid.models, drive: "muse" } })).toBe(
      `${Config.PATH}: models.drive: model must be provider/model`,
    );
  });

  it("resolves a readFile that throws as Unexpected instead of rejecting (unhappy)", async () => {
    const io = {
      ...Io.fake(),
      readFile: async (): Promise<never> => {
        throw new TypeError("fs exploded");
      },
    };
    expect(jarl.error.is(await Config.load(io), Errors.Unexpected)).toBe(true);
  });
});

it.each([
  ["qemuServer", "reserveTimeout", "2 minutes"],
  ["qemuRunner", "downloadTimeout", "45 minutes"],
  ["qemuRunner", "poweroffTimeout", "5 minutes"],
  ["qemuRunner", "cacheHeartbeat", "3 minutes"],
  ["qemuRunner", "killGrace", "1 minute"],
])("refuses %s.%s when it exceeds the enclosing deadline", async (section, key, duration) => {
  const values = valid as Record<string, unknown>;
  expect(
    await refusal({
      ...valid,
      [section]: {
        ...(typeof values[section] === "object" && values[section] !== null ? values[section] : {}),
        [key]: duration,
      },
    }),
  ).toContain("must");
});
