import * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, MISSING, newJob } from "./support.ts";

const IMAGE = "22222222-2222-4222-8222-222222222222";

describe("a job's actions", () => {
  it("each job reads back only its own actions and images, oldest first (happy)", async () => {
    const { tests, actions } = await database();
    const drive = await newJob(tests);
    const other = await newJob(tests);
    const first = jarl.unwrap(await actions.startAction({ jobId: drive.id, request: { n: 1 } }));
    const second = jarl.unwrap(await actions.startAction({ jobId: drive.id, request: { n: 2 } }));
    jarl.unwrap(await actions.startAction({ jobId: other.id, request: { n: 9 } }));
    const third = jarl.unwrap(await actions.startAction({ jobId: drive.id, request: { n: 3 } }));
    jarl.unwrap(
      await actions.finishAction(
        second,
        { state: "completed", response: { ok: true } },
        { id: IMAGE, data: new Uint8Array([1, 2, 3]) },
      ),
    );

    const listed = jarl.unwrap(await actions.listActions(drive.id));
    expect(listed.map((row) => [row.id, row.jobId, row.request, row.state])).toEqual([
      [first, drive.id, { n: 1 }, null],
      [second, drive.id, { n: 2 }, "completed"],
      [third, drive.id, { n: 3 }, null],
    ]);
    expect(
      jarl.unwrap(await actions.listImages(drive.id)).map((image) => [image.id, image.actionId]),
    ).toEqual([[IMAGE, second]]);
    expect(jarl.unwrap(await actions.listImages(other.id))).toEqual([]);
    expect(
      jarl.unwrap(await actions.listRecentActions(drive.id, 2)).map((row) => row.request),
    ).toEqual([{ n: 2 }, { n: 3 }]);
    expect([...(jarl.unwrap(await actions.getImage(IMAGE)) ?? [])]).toEqual([1, 2, 3]);
  });

  it("an action for a job that does not exist is a database error and nothing is stored (unhappy)", async () => {
    const { actions } = await database();

    const started = await actions.startAction({ jobId: MISSING, request: {} });

    expect(jarl.error.is(started, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await actions.listActions(MISSING))).toEqual([]);
  });

  it("an image for an action that does not exist is a database error and nothing is stored (unhappy)", async () => {
    const { actions } = await database();

    const finished = await actions.finishAction(
      404,
      { state: "failed", response: null },
      { id: IMAGE, data: new Uint8Array([1]) },
    );

    expect(jarl.error.is(finished, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await actions.getImage(IMAGE))).toBeUndefined();
  });
});
