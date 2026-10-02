import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { asc, eq } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, MISSING, newJob } from "./support.ts";

type Setup = Awaited<ReturnType<typeof database>>;

const stored = async ({ db }: Setup, jobId: string) =>
  jarl.unwrap(
    await db.run((d) =>
      d
        .select()
        .from(DbSchema.moves)
        .where(eq(DbSchema.moves.jobId, jobId))
        .orderBy(asc(DbSchema.moves.id)),
    ),
  );

describe("a job's moves", () => {
  it("each guest move and refused reply is stored whole under its job (happy)", async () => {
    const setup = await database();
    const { tests, moves } = setup;
    const drive = await newJob(tests);
    const other = await newJob(tests);
    jarl.unwrap(
      await moves.recordMove({
        jobId: drive.id,
        kind: "move",
        step: 1,
        name: "send_keys",
        reason: "Press Super+L",
        arguments: { keys: "<M-l>" },
        outcome: "sent the keys",
      }),
    );
    jarl.unwrap(
      await moves.recordMove({ jobId: other.id, kind: "refused", step: null, outcome: "other" }),
    );
    jarl.unwrap(
      await moves.recordMove({
        jobId: drive.id,
        kind: "refused",
        step: 1,
        outcome: "reply: expected one tool call, got 2",
      }),
    );

    expect(
      (await stored(setup, drive.id)).map((row) => [
        row.kind,
        row.step,
        row.name,
        row.reason,
        row.arguments,
        row.outcome,
      ]),
    ).toEqual([
      ["move", 1, "send_keys", "Press Super+L", { keys: "<M-l>" }, "sent the keys"],
      ["refused", 1, null, null, null, "reply: expected one tool call, got 2"],
    ]);
  });

  it("a move for a job that does not exist is a database error, and nothing is stored (unhappy)", async () => {
    const setup = await database();
    const { moves } = setup;

    const recorded = await moves.recordMove({
      jobId: MISSING,
      kind: "refused",
      step: null,
      outcome: "orphan",
    });

    expect(jarl.error.is(recorded, Db.DatabaseError)).toBe(true);
    expect(await stored(setup, MISSING)).toEqual([]);
  });
});
