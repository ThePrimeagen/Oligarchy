import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as DecisionApi from "@oligarchy/decision-api";
import * as ScreenGrid from "@oligarchy/screen-grid";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Geometry from "./geometry.ts";
import type { CellAnswer, Failure, Locator, Location, Options, Request, Round } from "./types.ts";

export type { CellAnswer, Failure, Locator, Location, Options, Request, Round } from "./types.ts";
export { NotFound, notFound } from "./errors.ts";

declare module "@oligarchy/app" {
  interface Services {
    locator: App.Register<"locator", Locator>;
  }
}

// One ask, and one more after retryWait when Clef was busy, down or slow.
const ATTEMPTS = 2;
const NEVER = new AbortController().signal;

const passing = (error: DecisionApi.Failure): boolean =>
  jarl.error.is(error, DecisionApi.RateLimited) ||
  jarl.error.is(error, DecisionApi.Unavailable) ||
  jarl.error.is(error, DecisionApi.TimedOut);

const question = (request: Request, cell: ScreenGrid.Cell): string =>
  `In image 2, is ${request.target} in grid cell ${cell.label} (column ${cell.label[0]}, row ${cell.row + 1})?` +
  (request.hint === undefined ? "" : ` ${request.hint}`);

const described = (view: ScreenGrid.View, screen: ScreenGrid.Screen, first: boolean): string => {
  const grid = `${view.columns} lettered columns (A-${view.cells[view.columns - 1]?.label[0]}, along the top) and ${view.rows} numbered rows (1-${view.rows}, down the left)`;
  if (first) {
    return `Image 2 shows the whole screen with a grid of ${grid}. Image 1 is the whole screen without the grid.`;
  }
  const { left, top, right, bottom } = view.box;
  const zoom = (screen.width / (right - left)).toFixed(1);
  return `Image 2 shows the screen region x ${left}-${right}, y ${top}-${bottom}, enlarged ${zoom}x, with ${grid}. Image 1 is the whole screen.`;
};

export const create = App.createService<DecisionApi.DecisionApi, Options, Locator>(
  (services, options) => {
    const ask = (request: DecisionApi.Request, signal: AbortSignal) =>
      Async.repeat(() => services["decision-api"].decide(request), ATTEMPTS, {
        retry: (error) =>
          passing(error) ? { retry: true, delay: options.retryWaitMs } : { retry: false },
        signal,
      })();

    const round = async (
      request: Request,
      screen: ScreenGrid.Screen,
      context: ScreenGrid.Image,
      box: ScreenGrid.Box,
      first: boolean,
      signal: AbortSignal,
    ): Promise<jarl.Result<Round, Failure>> => {
      const viewed = await ScreenGrid.view(screen, {
        box,
        columns: options.grid,
        rows: options.grid,
        width: options.viewWidth,
      });
      if (jarl.is_err(viewed)) {
        return viewed;
      }
      const view = jarl.value(viewed);
      const answered = await ask(
        {
          state: {
            task: request.task,
            screen: `${screen.width}x${screen.height} pixels, origin top-left`,
            view: described(view, screen, first),
          },
          images: [
            { contentType: context.contentType, bytes: context.bytes },
            { contentType: view.contentType, bytes: view.bytes },
          ],
          questions: Object.fromEntries(
            view.cells.map((cell) => [
              cell.label,
              { type: "noul" as const, instructions: question(request, cell) },
            ]),
          ),
          timeoutMs: options.callTimeoutMs,
          signal,
        },
        signal,
      );
      if (jarl.is_err(answered)) {
        return answered;
      }
      const decision = jarl.value(answered);
      const cells: ReadonlyArray<CellAnswer> = view.cells.map((cell) => {
        const answer = decision.answers[cell.label];
        return { label: cell.label, box: cell.box, p: answer?.type === "noul" ? answer.noul : 0 };
      });
      return jarl.ok({
        box,
        cells,
        best: Math.max(...cells.map((cell) => cell.p)),
        point: Geometry.weightedCentre(
          cells.map((cell) => cell.box),
          cells.map((cell) => cell.p),
          options.power,
        ),
        inputTokens: decision.usage.inputTokens,
      });
    };

    const locate = async (request: Request): Promise<jarl.Result<Location, Failure>> => {
      const signal = request.signal ?? NEVER;
      if (signal.aborted) {
        return jarl.err(
          jarl.error.is(signal.reason, Async.Aborted)
            ? signal.reason
            : new Async.Aborted("aborted"),
        );
      }
      const opened = await ScreenGrid.open(request.screen);
      if (jarl.is_err(opened)) {
        return opened;
      }
      const screen = jarl.value(opened);
      const pictured = await ScreenGrid.whole(screen, options.contextWidth);
      if (jarl.is_err(pictured)) {
        return pictured;
      }
      const context = jarl.value(pictured);
      const rounds: Round[] = [];
      let box: ScreenGrid.Box = { left: 0, top: 0, right: screen.width, bottom: screen.height };
      for (let k = 0; k < options.rounds; k += 1) {
        const looked = await round(request, screen, context, box, k === 0, signal);
        if (jarl.is_err(looked)) {
          return looked;
        }
        const done = jarl.value(looked);
        if (k === 0 && done.best < options.threshold) {
          return jarl.err(Errors.notFound(done.best, options.threshold));
        }
        rounds.push(done);
        box = Geometry.nextBox(done.point, box, options.grid, options.boxScale, screen);
      }
      const pixel = rounds[rounds.length - 1]?.point ?? {
        x: screen.width / 2,
        y: screen.height / 2,
      };
      return jarl.ok({ x: pixel.x / screen.width, y: pixel.y / screen.height, pixel, rounds });
    };

    return { service: "locator", locate };
  },
);
