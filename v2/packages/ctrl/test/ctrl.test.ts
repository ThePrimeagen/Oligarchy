import * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, failing, MISSING, newDrive } from "./support.ts";

const SERVER = "11111111-1111-4111-8111-111111111111";
const IMAGE = "22222222-2222-4222-8222-222222222222";
const PNG = new Uint8Array([137, 80, 78, 71]);

describe("a job's evidence", () => {
  it("is the job, its test run and definition, and everything recorded of its guest: VM changes, its turn's log lines, actions, images, debug log and diagnosis (happy)", async () => {
    const { tests, actions, logs, debugLogs, vmStatus, diagnosis, ctrl } = await database();
    const { run, job } = await newDrive(tests);
    const other = await newDrive(tests);
    const line = (text: string, runId: string) =>
      logs.insertLog({ text, level: "info", location: "qemu-server", runId });
    jarl.unwrap(await tests.runJob(job.id, SERVER));
    jarl.unwrap(await vmStatus.record(job.id, "running"));
    jarl.unwrap(await line("intent start; Press Super+L", run.id));
    jarl.unwrap(await line("another run's line", other.run.id));
    const keys = jarl.unwrap(
      await actions.startAction({ jobId: job.id, request: { execute: "send-key" } }),
    );
    jarl.unwrap(await actions.finishAction(keys, { state: "completed", response: {} }));
    const shot = jarl.unwrap(
      await actions.startAction({ jobId: job.id, request: { execute: "screendump" } }),
    );
    jarl.unwrap(
      await actions.finishAction(
        shot,
        { state: "completed", response: {} },
        { id: IMAGE, data: PNG },
      ),
    );
    jarl.unwrap(await actions.startAction({ jobId: other.job.id, request: { execute: "quit" } }));
    jarl.unwrap(await vmStatus.stop(job.id, { status: "stopped" }));
    jarl.unwrap(await tests.completeJob(job.id));
    jarl.unwrap(await debugLogs.saveDebugLog(job.id, { serial: "omarchy login:", qemu: "" }));
    jarl.unwrap(await diagnosis.createErrorType("lock_screen_missed", "the lock never showed"));
    jarl.unwrap(
      await diagnosis.saveDiagnosis({
        jobId: job.id,
        verdict: "failed",
        errorType: "lock_screen_missed",
        summary: "the last image is the desktop",
        model: "muse-spark-1.3",
      }),
    );

    const evidence = jarl.unwrap(await ctrl.getEvidence(job.id));

    expect(evidence).toMatchObject({
      job: { id: job.id, action: "drive", status: "completed" },
      run: { id: run.id, iso: "https://iso.omarchy.org/omarchy-4.0.4.iso" },
      suite: null,
      definition: { name: "lock-screen", proof: "The lock screen shows the clock" },
      debugLog: { jobId: job.id, sources: { serial: "omarchy login:" } },
      diagnosis: { jobId: job.id, verdict: "failed", errorType: "lock_screen_missed" },
    });
    expect(evidence.vmStatus.map((row) => row.status)).toEqual(["running", "stopped"]);
    expect(evidence.logs.map((row) => row.text)).toEqual(["intent start; Press Super+L"]);
    expect(evidence.actions.map((row) => row.id)).toEqual([keys, shot]);
    expect(evidence.images.map((image) => [image.id, image.actionId])).toEqual([[IMAGE, shot]]);
  });

  it("of a job that does not exist is refused with NotFound (unhappy)", async () => {
    const { ctrl } = await database();

    const evidence = await ctrl.getEvidence(MISSING);

    if (!jarl.error.is(evidence, Stores.Tests.NotFound)) {
      throw new Error("expected NotFound");
    }
    expect(evidence.error.message).toBe(`getEvidence: no job ${MISSING}`);
  });

  it("of a diagnose job is refused with InvalidState: evidence is of the drive or setup it judges (unhappy)", async () => {
    const { tests, ctrl } = await database();
    const { run, job } = await newDrive(tests);
    jarl.unwrap(await tests.runJob(job.id, SERVER));
    jarl.unwrap(await tests.completeJob(job.id));
    const review = jarl.unwrap(await tests.createJob(run.id, "diagnose"));

    const evidence = await ctrl.getEvidence(review.id);

    if (!jarl.error.is(evidence, Stores.Tests.InvalidState)) {
      throw new Error("expected InvalidState");
    }
    expect(evidence.error.message).toBe(
      `getEvidence: job ${review.id} is a diagnose; evidence is of the drive or setup it judges`,
    );
  });

  it("of a job nothing was recorded for has empty lists, and no debug log or diagnosis (unhappy)", async () => {
    const { tests, ctrl } = await database();
    const { job } = await newDrive(tests);

    const evidence = jarl.unwrap(await ctrl.getEvidence(job.id));

    expect(evidence).toMatchObject({
      job: { id: job.id, status: "pending" },
      vmStatus: [],
      logs: [],
      actions: [],
      images: [],
      debugLog: null,
      diagnosis: null,
    });
  });

  it("when the database fails is the database's error (unhappy)", async () => {
    const error = new Db.DatabaseError("connection refused");

    const evidence = await failing(error).getEvidence(MISSING);

    if (!jarl.error.is(evidence, Db.DatabaseError)) {
      throw new Error("expected DatabaseError");
    }
    expect(evidence.error).toBe(error);
  });
});

describe("a screenshot", () => {
  it("is the PNG's bytes, by the id the evidence lists it under (happy)", async () => {
    const { tests, actions, ctrl } = await database();
    const { job } = await newDrive(tests);
    const shot = jarl.unwrap(
      await actions.startAction({ jobId: job.id, request: { execute: "screendump" } }),
    );
    jarl.unwrap(
      await actions.finishAction(
        shot,
        { state: "completed", response: {} },
        { id: IMAGE, data: PNG },
      ),
    );

    const image = jarl.unwrap(await ctrl.getImage(IMAGE));

    expect([...image]).toEqual([...PNG]);
  });

  it("no image has is refused with NotFound (unhappy)", async () => {
    const { ctrl } = await database();

    const image = await ctrl.getImage(MISSING);

    if (!jarl.error.is(image, Stores.Tests.NotFound)) {
      throw new Error("expected NotFound");
    }
    expect(image.error.message).toBe(`getImage: no image ${MISSING}`);
  });

  it("when the database fails is the database's error (unhappy)", async () => {
    const error = new Db.DatabaseError("connection refused");

    const image = await failing(error).getImage(IMAGE);

    if (!jarl.error.is(image, Db.DatabaseError)) {
      throw new Error("expected DatabaseError");
    }
    expect(image.error).toBe(error);
  });
});
