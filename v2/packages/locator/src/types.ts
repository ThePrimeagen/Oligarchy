import type * as DecisionApi from "@oligarchy/decision-api";
import type * as ScreenGrid from "@oligarchy/screen-grid";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";

// Every value comes from oligarchy.json's locator section; packages/env/src/config.ts says what each does.
// How a round takes its point: "highest" the centre of its best cell, "pcenter" the p^power
// weighted centre of every cell.
export type Pick = "highest" | "pcenter";

export type Options = {
  readonly grid: number;
  // One per round, as deep as the search goes.
  readonly rounds: ReadonlyArray<Pick>;
  readonly power: number;
  readonly boxScale: number;
  readonly threshold: number;
  readonly overviewScale: number;
  readonly gridImageScale: number;
  readonly quality: number;
  readonly callTimeoutMs: number;
  readonly retries: number;
  readonly retryWaitMs: number;
};

export type Request = {
  // A PNG, JPEG or WebP screenshot.
  readonly screen: Uint8Array;
  // Asked of every cell, each round. {cell} becomes the cell's label (C3), {column} its letter
  // and {row} its number; {cell} is required, or every cell would be asked the same thing.
  readonly question: string;
  // What the click is for, given to Clef as state.
  readonly task: string;
  readonly signal?: AbortSignal;
};

export type CellAnswer = {
  readonly label: string;
  readonly box: ScreenGrid.Box;
  readonly p: number;
};

export type Round = {
  readonly box: ScreenGrid.Box;
  // Image 2 of this round's ask, as Clef was sent it.
  readonly image: ScreenGrid.GridImage;
  readonly pick: Pick;
  readonly cells: ReadonlyArray<CellAnswer>;
  readonly best: number;
  readonly point: ScreenGrid.Point;
  readonly inputTokens: number;
};

// x and y are fractions of the screen's width and height, as the guest's pointer takes them;
// pixel is the same point in screenshot pixels.
export type Location = {
  readonly x: number;
  readonly y: number;
  readonly pixel: ScreenGrid.Point;
  // Image 1 of every round's ask.
  readonly overview: ScreenGrid.Image;
  readonly rounds: ReadonlyArray<Round>;
};

// DecisionApi.Failure includes Async.Aborted.
export type Failure =
  | Errors.NotFound
  | Errors.QuestionInvalid
  | ScreenGrid.ImageInvalid
  | ScreenGrid.BoxInvalid
  | DecisionApi.Failure;

export type Locator = {
  readonly service: "locator";
  readonly locate: (request: Request) => Promise<jarl.Result<Location, Failure>>;
};
