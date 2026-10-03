import type * as DecisionApi from "@oligarchy/decision-api";
import type * as ScreenGrid from "@oligarchy/screen-grid";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";

// Every value comes from oligarchy.json's locator section; see the README for what each does.
export type Options = {
  readonly grid: number;
  readonly rounds: number;
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
  // What is visibly there, as the question names it: "the word 'Lock'".
  readonly target: string;
  // Said after every question, to tell the target from look-alikes.
  readonly hint?: string;
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
  readonly rounds: ReadonlyArray<Round>;
};

// DecisionApi.Failure includes Async.Aborted.
export type Failure =
  | Errors.NotFound
  | ScreenGrid.ImageInvalid
  | ScreenGrid.BoxInvalid
  | DecisionApi.Failure;

export type Locator = {
  readonly service: "locator";
  readonly locate: (request: Request) => Promise<jarl.Result<Location, Failure>>;
};
