import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import type * as Env from "@oligarchy/env";
import * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";

export type Services = App.Needs<
  | Db.Database
  | Stores.Tests.Tests
  | Stores.Actions.Actions
  | Stores.Logs.Logs
  | Stores.VmStatus.VmStatus
  | Stores.DebugLogs.DebugLogs
  | Stores.Diagnosis.Diagnosis
>;

export const createServices = (env: { readonly vars: { readonly databaseUrl: Env.Secret } }) => {
  const db = Db.create({}, { url: env.vars.databaseUrl });
  return {
    db,
    tests: Stores.Tests.create({ db }),
    actions: Stores.Actions.create({ db }),
    logs: Stores.Logs.create({ db }),
    vmStatus: Stores.VmStatus.create({ db }),
    debugLogs: Stores.DebugLogs.create({ db }),
    diagnosis: Stores.Diagnosis.create({ db }),
  } satisfies Services;
};

export const closeServices = (
  services: App.Needs<Db.Database>,
): Promise<jarl.Result<void, Db.DatabaseError>> => services.db.close();
