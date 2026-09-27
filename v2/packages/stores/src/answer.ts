import type * as Db from "@oligarchy/db";
import type * as jarl from "jarl";

export type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;
