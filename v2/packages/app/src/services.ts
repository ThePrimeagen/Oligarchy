import type * as Db from "@oligarchy/db";

// Every shared service, by name, one per line as each one lands. A program adds its own service
// from its own package with `declare module "@oligarchy/app"`.
export interface Services {
  db: Db.Database;
}
