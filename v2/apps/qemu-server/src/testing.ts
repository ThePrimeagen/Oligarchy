// A fake router for tests: each function answers as told, or reserved and relinquished, and keeps
// every request the routes handed it.
import * as jarl from "jarl";
import type * as Routes from "./routes.ts";

export const router = (
  told: Partial<Routes.Router> = {},
): { readonly router: Routes.Router; readonly handed: ReadonlyArray<unknown> } => {
  const handed: Array<unknown> = [];
  const keep =
    <R, A>(answer: (request: R) => Promise<A>) =>
    (request: R) => {
      handed.push(request);
      return answer(request);
    };
  const reserve: Routes.Router["reserve"] = told.reserve ?? (async () => jarl.ok("reserved"));
  const relinquish: Routes.Router["relinquish"] =
    told.relinquish ?? (async () => jarl.ok("relinquished"));
  return { router: { reserve: keep(reserve), relinquish: keep(relinquish) }, handed };
};
