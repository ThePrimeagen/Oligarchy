import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    // The migrated, seeded container database; "" without Docker. Tests work in their file's
    // copy of it, `Postgres.getDbUrl()`.
    databaseTemplateUrl: string;
  }
}
