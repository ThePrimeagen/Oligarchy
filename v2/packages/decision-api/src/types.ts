import type * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";

export type Model = "clef" | "clef-flash";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type Content = string | readonly Json[] | { readonly [key: string]: Json };
export type ImageType = "image/png" | "image/jpeg" | "image/webp";
export type Image =
  | { readonly contentType: ImageType; readonly bytes: Uint8Array }
  | { readonly dataUrl: `data:${ImageType};base64,${string}` };

export type Question =
  | {
      readonly type: "noul";
      readonly instructions: Content;
      readonly criteria?: { readonly true?: Content; readonly false?: Content };
    }
  | {
      readonly type: "choice";
      readonly instructions: Content;
      readonly criteria: Readonly<Record<string, Content | null>>;
    }
  | {
      readonly type: "score";
      readonly instructions: Content;
      readonly criteria: readonly Content[];
    };

export type Questions = Readonly<Record<string, Question>>;
export type Request<Q extends Questions = Questions> = {
  readonly state: Json;
  readonly images?: readonly Image[];
  readonly questions: Q;
  readonly model?: Model;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type NoulAnswer = { readonly type: "noul"; readonly noul: number };
export type ChoiceAnswer<K extends string> = {
  readonly type: "choice";
  readonly choice: K;
  readonly probabilities: Readonly<Record<K, number>>;
  readonly confidence: number;
};

export type Level<C extends readonly Content[]> = number extends C["length"]
  ? `${number}`
  : Extract<keyof C, `${number}`>;

export type ScoreAnswer<C extends readonly Content[]> = {
  readonly type: "score";
  readonly score: number;
  readonly probabilities: Readonly<Record<Level<C>, number>>;
  readonly legend: Readonly<Record<Level<C>, Content>>;
  readonly confidence: number;
};

export type Answer<Q extends Question> = Q extends { readonly type: "noul" }
  ? NoulAnswer
  : Q extends { readonly type: "choice"; readonly criteria: infer C }
    ? ChoiceAnswer<Extract<keyof C, string>>
    : Q extends { readonly type: "score"; readonly criteria: infer C extends readonly Content[] }
      ? ScoreAnswer<C>
      : never;

export type Response<Q extends Questions = Questions> = {
  readonly model: Model;
  readonly answers: { readonly [K in keyof Q]: Answer<Q[K]> };
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
};

export type Failure =
  | Errors.InvalidRequest
  | Errors.Refused
  | Errors.RateLimited
  | Errors.Unavailable
  | Errors.InvalidResponse
  | Errors.TimedOut
  | Async.Aborted;

export type DecisionApi = {
  readonly service: "decision-api";
  readonly decide: <const Q extends Questions>(
    request: Request<Q>,
  ) => Promise<jarl.Result<Response<Q>, Failure>>;
};

export type Options = {
  readonly accountId: string;
  readonly token: Env.Secret;
  readonly model?: Model;
  readonly timeoutMs?: number;
};
