import * as HttpFake from "@oligarchy/http/testing";
import * as z from "zod";

export type Asked = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  // The query's first field, `teams` or `issueUpdate`: what the request asks for.
  readonly field: string;
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
};

// `index` counts the requests this Linear was asked, from 0.
export type Answer = (asked: Asked, index: number) => HttpFake.Reply | Promise<HttpFake.Reply>;

const Body = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

const fieldOf = (query: string): string => /\{\s*(\w+)/.exec(query)?.[1] ?? "";

// A Linear answered by `answer`, keeping every request it was asked in the order it was asked.
export const linear = (answer: Answer) => {
  const asked: Array<Asked> = [];
  const { http } = HttpFake.http((request) => {
    const body = Body.parse(request.body);
    const one: Asked = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      field: fieldOf(body.query),
      query: body.query,
      variables: body.variables ?? {},
    };
    asked.push(one);
    return answer(one, asked.length - 1);
  });
  return { asked, http };
};

export const data = (value: unknown): Response => HttpFake.json({ data: value });

export const errors = (...messages: ReadonlyArray<string>): Response =>
  HttpFake.json({ errors: messages.map((message) => ({ message })), data: null });

export const labelId = (name: string): string => `label-${name}`;
export const stateId = (name: string): string => `state-${name}`;

export const noNodes = (field: string): Response => data({ [field]: { nodes: [] } });
export const updated = (success = true): Response => data({ issueUpdate: { success } });
export const commented = (success = true): Response => data({ commentCreate: { success } });

export const page = (nodes: ReadonlyArray<unknown>, next: string | null | undefined): Response =>
  data({
    issues: { nodes, pageInfo: { hasNextPage: next !== undefined, endCursor: next ?? null } },
  });

const Input = z.record(z.string(), z.unknown());

// What an update or a create was asked to write.
export const input = (asked: { readonly variables: Readonly<Record<string, unknown>> }) =>
  Input.parse(asked.variables["input"]);

const named = (asked: Asked, key: string): string => String(asked.variables[key]);

const listed = (n: number) => ({
  identifier: `OLI-${String(n)}`,
  title: `ticket ${String(n)}`,
  url: `https://linear.app/OLI-${String(n)}`,
  updatedAt: "2026-09-27T00:00:00.000Z",
});

// A board that has everything but the labels named in `missing`, which it creates when asked: the
// team, the user, each state asked for by name, every create, update and comment taken, and two
// pages of tickets in every column.
export const board =
  (missing: ReadonlyArray<string> = []): Answer =>
  (asked) => {
    switch (asked.field) {
      case "teams":
        return data({ teams: { nodes: [{ id: "team-id" }] } });
      case "issueLabels":
        return missing.includes(named(asked, "name"))
          ? noNodes("issueLabels")
          : data({ issueLabels: { nodes: [{ id: labelId(named(asked, "name")) }] } });
      case "issueLabelCreate":
        return data({
          issueLabelCreate: {
            success: true,
            issueLabel: { id: labelId(String(input(asked)["name"])) },
          },
        });
      case "users":
        return data({ users: { nodes: [{ id: "user-id" }] } });
      case "workflowStates":
        return data({ workflowStates: { nodes: [{ id: stateId(named(asked, "name")) }] } });
      case "issueCreate":
        return data({
          issueCreate: {
            success: true,
            issue: { id: "issue-OLI-42", identifier: "OLI-42", url: "https://linear.app/OLI-42" },
          },
        });
      case "issueUpdate":
        return updated();
      case "commentCreate":
        return commented();
      case "issues":
        return asked.variables["after"] === undefined
          ? page([listed(1)], "cursor-1")
          : page([listed(2)], undefined);
      default:
        throw new Error(`the fake has no answer for ${asked.field}`);
    }
  };

export const happy = board();

// `on` answers every request, except those from the `at`th (from 0) on, which take `replies` in
// turn: a fault, and what the request is answered when it is sent again.
export const faulted = (on: Answer, at: number, replies: ReadonlyArray<() => HttpFake.Reply>) =>
  linear((asked, index) => {
    const reply = replies[index - at];
    return reply === undefined ? on(asked, index) : reply();
  });
