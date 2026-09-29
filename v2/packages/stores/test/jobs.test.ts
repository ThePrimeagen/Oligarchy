import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Jobs from "../src/jobs.ts";
import { database, failure } from "./support.ts";

type Setup = Awaited<ReturnType<typeof database>>;
type Moved = jarl.Result<Jobs.Job, unknown>;

const RUN = { iso: "omarchy-3.1.iso", serverUrl: "http://qemu-1:8080" };
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const MALFORMED = "not-a-job";
const LIVE: ReadonlyArray<Jobs.Status> = ["pending", "running", "needs_review", "reviewing"];
const TERMINAL: ReadonlyArray<Jobs.Status> = ["succeeded", "failed", "errored", "aborted"];

const define = async ({ definitions }: Setup, name: string): Promise<number> =>
  jarl.unwrap(
    await definitions.defineTestDefinition({
      name,
      description: `${name} works`,
      instruction: `check ${name}`,
      proof: `a screenshot of ${name}`,
    }),
  ).id;

const only = <T>(items: ReadonlyArray<T>): T => {
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0) {
    throw new Error(`expected one item, got ${String(items.length)}`);
  }
  return item;
};

const createOne = async (setup: Setup, name = "lock-screen"): Promise<Jobs.Job> =>
  only(jarl.unwrap(await setup.jobs.create({ ...RUN, definitions: [await define(setup, name)] })));

// A new test job, moved to `status` by the store's own moves.
const at = async (setup: Setup, status: Jobs.Status): Promise<Jobs.Job> => {
  const { jobs } = setup;
  const start = (id: string) => jobs.start(id, "client-a");
  const complete = (id: string) => jobs.complete(id);
  const toReview = [start, complete, start];
  const steps: Record<Jobs.Status, ReadonlyArray<(id: string) => Promise<Moved>>> = {
    pending: [],
    running: [start],
    needs_review: [start, complete],
    reviewing: toReview,
    succeeded: [...toReview, (id) => jobs.judge(id, "passed", "the lock screen showed")],
    failed: [...toReview, (id) => jobs.judge(id, "failed", "no lock screen")],
    errored: [(id) => jobs.error(id, "the vm died")],
    aborted: [(id) => jobs.abort(id)],
  };
  let job = await createOne(setup);
  for (const step of steps[status]) {
    job = jarl.unwrap(await step(job.id));
  }
  return job;
};

const moves = async ({ jobs }: Setup, id: string) =>
  jarl.unwrap(await jobs.history(id)).map((event) => [event.from, event.to, event.reason]);

const outcome = (result: jarl.Result<unknown, { readonly name: string }>): string =>
  result.ok ? "ok" : result.error.name;

const written = async ({ db }: Setup) =>
  jarl.unwrap(
    await db.run(async (d) => ({
      runs: await d.$count(DbSchema.runs),
      jobs: await d.$count(DbSchema.jobs),
      events: await d.$count(DbSchema.jobEvents),
    })),
  );

describe("jobs", () => {
  it("carries a mint and a test from create to their end, and a rerun is a new job (happy)", async () => {
    const setup = await database();
    const { jobs } = setup;
    const mintDefinition = await define(setup, "mint");
    const lockDefinition = await define(setup, "lock-screen");

    const created = jarl.unwrap(
      await jobs.create({ ...RUN, definitions: [mintDefinition, lockDefinition] }),
    );
    expect(created.map((job) => [job.kind, job.status, job.definition])).toEqual([
      ["mint", "pending", mintDefinition],
      ["test", "pending", lockDefinition],
    ]);
    const [mint, lock] = created;
    if (mint === undefined || lock === undefined) {
      throw new Error("create made fewer jobs than it was given definitions");
    }
    expect(lock).toMatchObject({
      run: mint.run,
      iso: RUN.iso,
      serverUrl: RUN.serverUrl,
      client: null,
      report: null,
      previous: null,
      reason: null,
      startedAt: null,
      finishedAt: null,
    });

    expect(jarl.unwrap(await jobs.next([]))?.id).toBe(mint.id);
    const minting = jarl.unwrap(await jobs.start(mint.id, "client-a"));
    expect(minting).toMatchObject({ status: "running", client: "client-a" });
    expect(minting.startedAt).toBeInstanceOf(Date);
    const minted = jarl.unwrap(await jobs.complete(mint.id));
    expect(minted.status).toBe("succeeded");
    expect(minted.finishedAt).toBeInstanceOf(Date);

    expect(jarl.unwrap(await jobs.next([]))?.id).toBe(lock.id);
    expect(jarl.unwrap(await jobs.start(lock.id, "client-a")).status).toBe("running");
    const reported = jarl.unwrap(await jobs.report(lock.id, "passed", null));
    expect(reported).toMatchObject({
      status: "running",
      report: { status: "passed", reason: null },
    });
    expect(jarl.unwrap(await jobs.complete(lock.id)).status).toBe("needs_review");
    expect(jarl.unwrap(await jobs.next([]))?.id).toBe(lock.id);
    expect(jarl.unwrap(await jobs.start(lock.id, "client-b"))).toMatchObject({
      status: "reviewing",
      client: "client-b",
    });
    const judged = jarl.unwrap(await jobs.judge(lock.id, "failed", "the proof never landed"));
    expect(judged).toMatchObject({
      status: "failed",
      reason: "the proof never landed",
      report: { status: "passed", reason: null },
    });
    expect(jarl.unwrap(await jobs.next([]))).toBeUndefined();

    const rerun = jarl.unwrap(await jobs.rerun(lock.id));
    expect(rerun).toMatchObject({
      run: lock.run,
      definition: lockDefinition,
      kind: "test",
      status: "pending",
      client: null,
      report: null,
      previous: lock.id,
      reason: null,
    });
    expect(rerun.id).not.toBe(lock.id);
    expect(jarl.unwrap(await jobs.get(lock.id)).status).toBe("failed");
    expect(jarl.unwrap(await jobs.next([]))?.id).toBe(rerun.id);

    expect(await moves(setup, mint.id)).toEqual([
      [null, "pending", null],
      ["pending", "running", null],
      ["running", "succeeded", null],
    ]);
    expect(await moves(setup, lock.id)).toEqual([
      [null, "pending", null],
      ["pending", "running", null],
      ["running", "needs_review", null],
      ["needs_review", "reviewing", null],
      ["reviewing", "failed", "the proof never landed"],
    ]);
    expect(await moves(setup, rerun.id)).toEqual([[null, "pending", null]]);
    expect(jarl.unwrap(await jobs.list({ run: mint.run, count: 10 })).map((job) => job.id)).toEqual(
      [rerun.id, lock.id, mint.id],
    );
    expect(
      jarl.unwrap(await jobs.list({ status: "failed", count: 10 })).map((job) => job.id),
    ).toEqual([lock.id]);
  });

  it("ends a job from every live status with error or abort, keeping the reason (happy)", async () => {
    const setup = await database();
    for (const status of LIVE) {
      const errored = jarl.unwrap(await setup.jobs.error((await at(setup, status)).id, "vm died"));
      expect([status, errored.status, errored.reason]).toEqual([status, "errored", "vm died"]);
      expect(errored.finishedAt).toBeInstanceOf(Date);
      expect((await moves(setup, errored.id)).at(-1)).toEqual([status, "errored", "vm died"]);

      const aborted = jarl.unwrap(await setup.jobs.abort((await at(setup, status)).id));
      expect([status, aborted.status, aborted.reason]).toEqual([status, "aborted", null]);
      expect((await moves(setup, aborted.id)).at(-1)).toEqual([status, "aborted", null]);
    }
  });

  it("refuses a create with no definitions and writes nothing (sad)", async () => {
    const setup = await database();

    const created = await setup.jobs.create({ ...RUN, definitions: [] });

    expect(failure(created, Jobs.NoDefinitions).message).toBe("jobs: a run needs a definition");
    expect(await written(setup)).toEqual({ runs: 0, jobs: 0, events: 0 });
  });

  it("refuses a create naming a definition that does not exist and writes nothing (sad)", async () => {
    const setup = await database();
    const real = await define(setup, "lock-screen");

    const created = await setup.jobs.create({ ...RUN, definitions: [real, 404_404] });

    const refused = failure(created, Jobs.DefinitionNotFound);
    expect(refused.definitions).toEqual([404_404]);
    expect(refused.message).toBe("jobs: no definition 404404");
    expect(await written(setup)).toEqual({ runs: 0, jobs: 0, events: 0 });
  });

  it("returns a DatabaseError from every operation while the database is down (sad)", async () => {
    const setup = await database();
    const { jobs } = setup;
    const job = await createOne(setup);
    await setup.fake.stop();

    const calls: Record<string, () => Promise<jarl.Result<unknown, { readonly name: string }>>> = {
      create: () => jobs.create({ ...RUN, definitions: [job.definition] }),
      get: () => jobs.get(job.id),
      list: () => jobs.list({ count: 10 }),
      next: () => jobs.next([]),
      history: () => jobs.history(job.id),
      start: () => jobs.start(job.id, "client-a"),
      report: () => jobs.report(job.id, "passed", null),
      complete: () => jobs.complete(job.id),
      judge: () => jobs.judge(job.id, "passed", null),
      requeueReview: () => jobs.requeueReview(job.id, "reviewer lost"),
      error: () => jobs.error(job.id, "vm died"),
      abort: () => jobs.abort(job.id),
      rerun: () => jobs.rerun(job.id),
    };

    for (const [name, call] of Object.entries(calls)) {
      const result = await call();
      expect([name, outcome(result)]).toEqual([name, "DatabaseError"]);
      expect(jarl.error.is(result, Db.DatabaseError)).toBe(true);
    }
  });

  it("returns JobNotFound from every move on an unknown or malformed id (sad)", async () => {
    const setup = await database();
    const { jobs } = setup;
    await createOne(setup);

    for (const id of [UNKNOWN, MALFORMED]) {
      const calls: Record<string, () => Promise<jarl.Result<unknown, { readonly name: string }>>> =
        {
          get: () => jobs.get(id),
          history: () => jobs.history(id),
          start: () => jobs.start(id, "client-a"),
          report: () => jobs.report(id, "passed", null),
          complete: () => jobs.complete(id),
          judge: () => jobs.judge(id, "passed", null),
          requeueReview: () => jobs.requeueReview(id, "reviewer lost"),
          error: () => jobs.error(id, "vm died"),
          abort: () => jobs.abort(id),
          rerun: () => jobs.rerun(id),
        };
      for (const [name, call] of Object.entries(calls)) {
        const result = await call();
        expect([id, name, outcome(result)]).toEqual([id, name, "JobNotFound"]);
        expect(failure(result, Jobs.JobNotFound).job).toBe(id);
      }
    }
    expect(await written(setup)).toMatchObject({ jobs: 1, events: 1 });
  });

  it("refuses every move from a status it does not start from, changing nothing (sad)", async () => {
    const setup = await database();
    const { jobs } = setup;
    const cases: ReadonlyArray<{
      readonly move: string;
      readonly from: Jobs.Status;
      readonly expected: ReadonlyArray<Jobs.Status>;
      readonly call: (id: string) => Promise<Moved>;
    }> = [
      {
        move: "start",
        from: "running",
        expected: ["pending", "needs_review"],
        call: (id) => jobs.start(id, "client-b"),
      },
      {
        move: "start",
        from: "succeeded",
        expected: ["pending", "needs_review"],
        call: (id) => jobs.start(id, "client-b"),
      },
      { move: "complete", from: "pending", expected: ["running"], call: jobs.complete },
      { move: "complete", from: "needs_review", expected: ["running"], call: jobs.complete },
      {
        move: "judge",
        from: "running",
        expected: ["reviewing"],
        call: (id) => jobs.judge(id, "passed", null),
      },
      {
        move: "requeueReview",
        from: "needs_review",
        expected: ["reviewing"],
        call: (id) => jobs.requeueReview(id, "reviewer lost"),
      },
      {
        move: "error",
        from: "failed",
        expected: LIVE,
        call: (id) => jobs.error(id, "vm died"),
      },
      { move: "abort", from: "aborted", expected: LIVE, call: jobs.abort },
    ];

    for (const { move, from, expected, call } of cases) {
      const job = await at(setup, from);
      const before = await moves(setup, job.id);

      const refused = failure(await call(job.id), Jobs.StatusConflict);

      expect([move, refused.job, refused.expected, refused.actual]).toEqual([
        move,
        job.id,
        expected,
        from,
      ]);
      expect(refused.message).toBe(`jobs: job ${job.id} is ${from}, not ${expected.join(" or ")}`);
      expect([move, jarl.unwrap(await jobs.get(job.id))]).toEqual([move, job]);
      expect([move, await moves(setup, job.id)]).toEqual([move, before]);
    }
  });

  it("lets one of two starts at once win and refuses the other (sad)", async () => {
    const setup = await database();
    const job = await createOne(setup);

    const [a, b] = await Promise.all([
      setup.jobs.start(job.id, "client-a"),
      setup.jobs.start(job.id, "client-b"),
    ]);

    const won = [a, b].filter((result) => result.ok);
    const lost = [a, b].filter((result) => !result.ok);
    expect(won).toHaveLength(1);
    expect(failure(only(lost), Jobs.StatusConflict).actual).toBe("running");
    const winner = jarl.unwrap(only(won)).client;
    expect(jarl.unwrap(await setup.jobs.get(job.id))).toMatchObject({
      status: "running",
      client: winner,
    });
    expect(await moves(setup, job.id)).toEqual([
      [null, "pending", null],
      ["pending", "running", null],
    ]);
  });

  it("refuses a report on a job that is not running, keeping no report (sad)", async () => {
    const setup = await database();

    for (const status of ["pending", "needs_review", "failed"] as const) {
      const job = await at(setup, status);

      const refused = failure(
        await setup.jobs.report(job.id, "passed", "it locked"),
        Jobs.StatusConflict,
      );

      expect([status, refused.expected, refused.actual]).toEqual([status, ["running"], status]);
      expect(jarl.unwrap(await setup.jobs.get(job.id)).report).toBeNull();
    }
  });

  it("hands out mints first, then reviews, then drives, oldest first, skipping what it is told (happy)", async () => {
    const setup = await database();
    const { jobs } = setup;
    const first = await createOne(setup, "lock-screen");
    const second = await createOne(setup, "wifi");
    const mint = await createOne(setup, "mint");
    const next = async (skip: ReadonlyArray<string> = []) => jarl.unwrap(await jobs.next(skip))?.id;

    expect(await next()).toBe(mint.id);
    jarl.unwrap(await jobs.start(mint.id, "client-a"));
    expect(await next()).toBe(first.id);
    expect(await next([first.id])).toBe(second.id);
    expect(await next([first.id, second.id])).toBeUndefined();

    jarl.unwrap(await jobs.start(first.id, "client-a"));
    jarl.unwrap(await jobs.start(second.id, "client-a"));
    expect(await next()).toBeUndefined();
    jarl.unwrap(await jobs.complete(first.id));
    jarl.unwrap(await jobs.complete(second.id));
    expect(await next()).toBe(first.id);

    jarl.unwrap(await jobs.start(first.id, "client-b"));
    const requeued = jarl.unwrap(await jobs.requeueReview(first.id, "reviewer lost"));
    expect(requeued.status).toBe("needs_review");
    expect(await next()).toBe(second.id);
    expect((await moves(setup, first.id)).at(-1)).toEqual([
      "reviewing",
      "needs_review",
      "reviewer lost",
    ]);
  });

  it("refuses a rerun of a live job, and a second rerun names the first (sad)", async () => {
    const setup = await database();
    const { jobs } = setup;

    for (const status of LIVE) {
      const job = await at(setup, status);
      const before = await written(setup);

      const refused = failure(await jobs.rerun(job.id), Jobs.StatusConflict);

      expect([status, refused.expected, refused.actual]).toEqual([status, TERMINAL, status]);
      expect(await written(setup)).toEqual(before);
    }

    const failed = await at(setup, "failed");
    const rerun = jarl.unwrap(await jobs.rerun(failed.id));
    const before = await written(setup);

    const again = failure(await jobs.rerun(failed.id), Jobs.AlreadyRerun);

    expect([again.job, again.rerun]).toEqual([failed.id, rerun.id]);
    expect(again.message).toBe(`jobs: job ${failed.id} was already rerun as ${rerun.id}`);
    expect(await written(setup)).toEqual(before);
  });
});
