// Fake sessions for tests: each answers as told, or reserved, ended and stopped, and keeps every
// request the routes handed it.
import * as jarl from "jarl";
import type * as Routes from "./routes.ts";

export const sessions = (
  told: Partial<Routes.Sessions> = {},
): { readonly sessions: Routes.Sessions; readonly handed: ReadonlyArray<unknown> } => {
  const handed: Array<unknown> = [];
  const keep =
    <R, A>(answer: (request: R) => Promise<A>) =>
    (request: R) => {
      handed.push(request);
      return answer(request);
    };
  const reserve: Routes.Sessions["reserve"] = told.reserve ?? (async () => jarl.ok(undefined));
  const run: Routes.Sessions["run"] = told.run ?? (async () => jarl.ok("ended"));
  const abort: Routes.Sessions["abort"] = told.abort ?? (async () => "stopped");
  return { sessions: { reserve: keep(reserve), run: keep(run), abort: keep(abort) }, handed };
};
