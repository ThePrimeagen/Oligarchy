import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { desc, eq } from "drizzle-orm";
import type { Answer } from "./answer.ts";

export type DefinitionRow = typeof DbSchema.definitions.$inferSelect;

export type BasePromptRow = typeof DbSchema.basePrompts.$inferSelect;

export type DefinitionInput = {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
};

export type DefinedDefinition = {
  readonly id: number;
  // The row's place among its name's rows by id: 1 for a new name.
  readonly version: number;
};

export type Definitions = {
  readonly service: "definitions";
  readonly listTestDefinitions: () => Answer<ReadonlyArray<DefinitionRow>>;
  readonly findTestDefinition: (name: string) => Answer<DefinitionRow | undefined>;
  readonly listTestDefinitionHistory: (name?: string) => Answer<ReadonlyArray<DefinitionRow>>;
  readonly defineTestDefinition: (input: DefinitionInput) => Answer<DefinedDefinition>;
  readonly listTestBasePrompts: () => Answer<ReadonlyArray<BasePromptRow>>;
};

declare module "@oligarchy/app" {
  interface Services {
    definitions: App.Register<"definitions", Definitions>;
  }
}

export const create = (db: Db.Database): Definitions => ({
  service: "definitions",

  listTestDefinitions: () =>
    db.run((d) =>
      d
        .selectDistinctOn([DbSchema.definitions.name])
        .from(DbSchema.definitions)
        .orderBy(DbSchema.definitions.name, desc(DbSchema.definitions.id)),
    ),

  findTestDefinition: (name) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.definitions)
        .where(eq(DbSchema.definitions.name, name))
        .orderBy(desc(DbSchema.definitions.id))
        .limit(1);
      return row;
    }),

  listTestDefinitionHistory: (name) =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.definitions)
        .where(name === undefined ? undefined : eq(DbSchema.definitions.name, name))
        .orderBy(DbSchema.definitions.name, DbSchema.definitions.id),
    ),

  defineTestDefinition: (input) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(DbSchema.definitions)
        .values(input)
        .returning({ id: DbSchema.definitions.id });
      if (row === undefined) {
        throw new Error("defineTestDefinition: the insert returned no row");
      }
      const version = await tx.$count(
        DbSchema.definitions,
        eq(DbSchema.definitions.name, input.name),
      );
      return { id: row.id, version };
    }),

  listTestBasePrompts: () =>
    db.run((d) => d.select().from(DbSchema.basePrompts).orderBy(DbSchema.basePrompts.name)),
});
