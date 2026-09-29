import type * as Db from "@oligarchy/db";
import * as jarl from "jarl";

export type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;

// A query that can refuse on its own: its refusal, or the database's error, in one result.
export const settle = <T, E>(
  answer: jarl.Result<jarl.Result<T, E>, Db.DatabaseError>,
): jarl.Result<T, E | Db.DatabaseError> => (jarl.is_ok(answer) ? jarl.value(answer) : answer);
