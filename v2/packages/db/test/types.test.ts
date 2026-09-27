// Type checks only: check:types fails when one breaks. Nothing here calls main.
import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import { describe, expectTypeOf, it } from "vitest";
import * as Db from "../src/main.ts";

type Reads = { readonly flags: { readonly name: string } };
const environment = { command: "", flags: { name: "ada" } } as const;

// A database written inline, as a program's test fakes one.
const database = (): Db.Database => ({
  service: "db",
  run: async () => jarl.err(new Db.DatabaseError("the type tests never run a query")),
  migrate: async () => jarl.ok(undefined),
  close: async () => jarl.ok(undefined),
});

describe("the database as an app service", () => {
  it("is filed under db, and an app built with it hands main the database (happy)", () => {
    const closes = async (app: App.App<Reads, Db.Database>) => app.services.db.close();
    const app = new App.App(environment, { db: database() });
    expectTypeOf(app.services.db).toEqualTypeOf<Db.Database>();
    void (() => app.main(closes));
  });

  it("refuses it under another name, half a database under db, and a main the app cannot feed (unhappy)", () => {
    // @ts-expect-error the database is filed under db
    void new App.App(environment, { database: database() });
    // @ts-expect-error a database has every operation
    void new App.App(environment, { db: { service: "db", close: database().close } });
    const closes = async (app: App.App<Reads, Db.Database>) => app.services.db.close();
    const app = new App.App(environment, {});
    // @ts-expect-error the app has no database
    void (() => app.main(closes));
  });
});
