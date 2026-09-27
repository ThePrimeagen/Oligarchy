import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type { Answer } from "./answer.ts";

export type ActionState = (typeof DbSchema.actionState.enumValues)[number];

export type ActionRow = typeof DbSchema.actions.$inferSelect;

export type ActionInput = {
  readonly sessionId: string;
  readonly agentId: string;
  readonly request: unknown;
};

export type Outcome = { readonly state: ActionState; readonly response: unknown };

export type ImageInput = { readonly id: string; readonly data: Uint8Array };

export type Image = { readonly id: string; readonly actionId: number; readonly createdAt: Date };

export type RecentAction = {
  readonly id: number;
  readonly request: unknown;
  readonly state: ActionState | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
};

export type Actions = {
  readonly service: "actions";
  readonly startAction: (input: ActionInput) => Answer<number>;
  readonly finishAction: (id: number, outcome: Outcome, image?: ImageInput) => Answer<void>;
  readonly getImage: (id: string) => Answer<Uint8Array | undefined>;
  readonly listActions: (sessionId: string) => Answer<ReadonlyArray<ActionRow>>;
  readonly listImages: (sessionId: string) => Answer<ReadonlyArray<Image>>;
  readonly listRecentActions: (
    sessionId: string,
    limit: number,
  ) => Answer<ReadonlyArray<RecentAction>>;
};

declare module "@oligarchy/app" {
  interface Services {
    actions: App.Register<"actions", Actions>;
  }
}

export const create = (db: Db.Database): Actions => ({
  service: "actions",

  startAction: (input) =>
    db.run(async (d) => {
      const [row] = await d
        .insert(DbSchema.actions)
        .values({ sessionId: input.sessionId, agentId: input.agentId, request: input.request })
        .returning({ id: DbSchema.actions.id });
      if (row === undefined) {
        throw new Error("startAction: the insert returned no row");
      }
      return row.id;
    }),

  finishAction: (id, outcome, image) =>
    db.run(async (d) => {
      const close = { state: outcome.state, response: outcome.response, finishedAt: sql`now()` };
      if (image === undefined) {
        await d.update(DbSchema.actions).set(close).where(eq(DbSchema.actions.id, id));
        return;
      }
      await d.transaction(async (tx) => {
        await tx.update(DbSchema.actions).set(close).where(eq(DbSchema.actions.id, id));
        await tx
          .insert(DbSchema.images)
          .values({ id: image.id, actionId: id, data: Buffer.from(image.data) });
      });
    }),

  getImage: (id) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ data: DbSchema.images.data })
        .from(DbSchema.images)
        .where(eq(DbSchema.images.id, id));
      return row?.data;
    }),

  listActions: (sessionId) =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.actions)
        .where(eq(DbSchema.actions.sessionId, sessionId))
        .orderBy(DbSchema.actions.createdAt, DbSchema.actions.id),
    ),

  listImages: (sessionId) =>
    db.run((d) =>
      d
        .select({
          id: DbSchema.images.id,
          actionId: DbSchema.images.actionId,
          createdAt: DbSchema.actions.createdAt,
        })
        .from(DbSchema.images)
        .innerJoin(DbSchema.actions, eq(DbSchema.images.actionId, DbSchema.actions.id))
        .where(eq(DbSchema.actions.sessionId, sessionId))
        .orderBy(DbSchema.actions.createdAt, DbSchema.actions.id),
    ),

  listRecentActions: (sessionId, limit) =>
    db.run(async (d) => {
      const rows = await d
        .select({
          id: DbSchema.actions.id,
          request: DbSchema.actions.request,
          state: DbSchema.actions.state,
          createdAt: DbSchema.actions.createdAt,
          finishedAt: DbSchema.actions.finishedAt,
        })
        .from(DbSchema.actions)
        .where(eq(DbSchema.actions.sessionId, sessionId))
        .orderBy(desc(DbSchema.actions.id))
        .limit(limit);
      return rows.reverse();
    }),
});
