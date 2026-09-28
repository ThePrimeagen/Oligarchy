import * as z from "zod";
import type * as Linear from "../src/main.ts";

export type Asked = {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  // The query's first field, `teams` or `issueUpdate`: what the request asks for.
  readonly field: string;
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
};

type Answer = (asked: Asked, signal: AbortSignal) => Response | Promise<Response>;

const Body = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

const fieldOf = (query: string): string => /\{\s*(\w+)/.exec(query)?.[1] ?? "";

// A Linear answered by `answer`, keeping every request it was asked in the order it was asked.
export const linear = (answer: Answer) => {
  const asked: Array<Asked> = [];
  const fetch: Linear.Fetch = async (url, init) => {
    const body = Body.parse(JSON.parse(z.string().parse(init.body)));
    const one: Asked = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      field: fieldOf(body.query),
      query: body.query,
      variables: body.variables ?? {},
    };
    asked.push(one);
    return answer(one, init.signal ?? new AbortController().signal);
  };
  return { asked, fetch };
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const data = (value: unknown): Response => json({ data: value });

export const errors = (...messages: ReadonlyArray<string>): Response =>
  json({ errors: messages.map((message) => ({ message })), data: null });

// Settles only when the request's signal aborts, and then as fetch does: rejected with the reason.
export const hang = (signal: AbortSignal): Promise<Response> =>
  new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

export const TICKET = {
  id: "issue-OLI-42",
  identifier: "OLI-42",
  url: "https://linear.app/OLI-42",
};

export const labelId = (name: string): string => `label-${name}`;
export const stateId = (name: string): string => `state-${name}`;

export const team = (): Response => data({ teams: { nodes: [{ id: "team-id" }] } });
export const noNodes = (field: string): Response => data({ [field]: { nodes: [] } });
export const updated = (success = true): Response => data({ issueUpdate: { success } });
export const commented = (success = true): Response => data({ commentCreate: { success } });

export const page = (nodes: ReadonlyArray<unknown>, next: string | null | undefined): Response =>
  data({
    issues: { nodes, pageInfo: { hasNextPage: next !== undefined, endCursor: next ?? null } },
  });

const named = (asked: Asked, key: string): string => String(asked.variables[key]);

// Every request answered as a board that has everything: the team, each label and state asked
// for by name, and every update and comment taken.
export const happy: Answer = (asked) => {
  switch (asked.field) {
    case "teams":
      return team();
    case "issueLabels":
      return data({ issueLabels: { nodes: [{ id: labelId(named(asked, "name")) }] } });
    case "users":
      return data({ users: { nodes: [{ id: "user-id" }] } });
    case "workflowStates":
      return data({ workflowStates: { nodes: [{ id: stateId(named(asked, "name")) }] } });
    case "issue":
      return "ticket" in asked.variables
        ? data({ issue: { team: { states: { nodes: [{ id: stateId(named(asked, "state")) }] } } } })
        : data({ issue: { state: { id: stateId("Now") } } });
    case "issueCreate":
      return data({ issueCreate: { success: true, issue: TICKET } });
    case "issueUpdate":
      return updated();
    case "commentCreate":
      return commented();
    default:
      throw new Error(`the fake has no answer for ${asked.field}`);
  }
};
