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

export type Answer = (asked: Asked) => HttpFake.Reply | Promise<HttpFake.Reply>;

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
    return answer(one);
  });
  return { asked, http };
};

export const data = (value: unknown): Response => HttpFake.json({ data: value });

export const errors = (...messages: ReadonlyArray<string>): Response =>
  HttpFake.json({ errors: messages.map((message) => ({ message })), data: null });

const Input = z.record(z.string(), z.unknown());

// What an update or a create was asked to write.
export const input = (asked: Asked): Readonly<Record<string, unknown>> =>
  Input.parse(asked.variables["input"]);

const named = (asked: Asked, key: string): string => String(asked.variables[key]);

// A board that has everything: the team, the user, each label and state asked for by name, and
// every create, update and comment taken.
export const happy: Answer = (asked) => {
  switch (asked.field) {
    case "teams":
      return data({ teams: { nodes: [{ id: "team-id" }] } });
    case "issueLabels":
      return data({ issueLabels: { nodes: [{ id: `label-${named(asked, "name")}` }] } });
    case "users":
      return data({ users: { nodes: [{ id: "user-id" }] } });
    case "workflowStates":
      return data({ workflowStates: { nodes: [{ id: `state-${named(asked, "name")}` }] } });
    case "issueCreate":
      return data({
        issueCreate: {
          success: true,
          issue: { id: "issue-OLI-42", identifier: "OLI-42", url: "https://linear.app/OLI-42" },
        },
      });
    case "issueUpdate":
      return data({ issueUpdate: { success: true } });
    case "commentCreate":
      return data({ commentCreate: { success: true } });
    case "issues":
      return data({ issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    default:
      throw new Error(`the fake has no answer for ${asked.field}`);
  }
};

// The happy board, except the requests for `field`, which take `replies` in turn, one per send.
export const failing = (field: string, replies: ReadonlyArray<Answer>) => {
  let sends = 0;
  return linear((asked) => {
    if (asked.field !== field) {
      return happy(asked);
    }
    const reply = replies[sends] ?? happy;
    sends += 1;
    return reply(asked);
  });
};
