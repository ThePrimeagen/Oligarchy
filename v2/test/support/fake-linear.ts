import { Effect, Layer } from "effect";
import * as Linear from "../../src/ctrl/linear.ts";

export type LinearCall =
  | { readonly method: "teamId" }
  | { readonly method: "labelIds"; readonly teamId: string; readonly version: string }
  | { readonly method: "assigneeId" }
  | { readonly method: "createIssue"; readonly input: Linear.CreateIssueInput }
  | {
      readonly method: "describeIssue";
      readonly ticket: Linear.LinearTicket;
      readonly description: string;
    }
  | { readonly method: "listBacklog" };

export type FakeLinear = {
  readonly calls: Array<LinearCall>;
  readonly layer: Layer.Layer<Linear.Linear>;
};

export const TEAM_ID = "team-id";
export const USER_ID = "user-id";

export const labelId = (name: string): string => `label-${name}`;

export const ticketFor = (identifier: string): Linear.LinearTicket => ({
  id: `issue-${identifier}`,
  identifier,
  url: `https://linear.app/issue/${identifier}`,
});

// A Linear that records every call and answers as v1's tests scripted the API: team `team-id`,
// labels `label-<name>`, assignee `user-id`, issues OLI-42, OLI-43, ... in creation order.
// `overrides` script failures or other answers per method.
export const fakeLinear = (
  options: {
    readonly backlog?: ReadonlyArray<Linear.LinearBacklogTicket>;
    readonly overrides?: Partial<Linear.LinearService>;
  } = {},
): FakeLinear => {
  const calls: Array<LinearCall> = [];
  let created = 0;
  const record = <A, E>(call: LinearCall, answer: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      calls.push(call);
      return answer;
    });
  const defaults: Linear.LinearService = {
    teamId: record({ method: "teamId" }, Effect.succeed(TEAM_ID)),
    labelIds: (teamId, version) =>
      record(
        { method: "labelIds", teamId, version },
        Effect.succeed([labelId(Linear.AGENT_TEST_LABEL), labelId(version)]),
      ),
    assigneeId: record({ method: "assigneeId" }, Effect.succeed(USER_ID)),
    createIssue: (input) =>
      record(
        { method: "createIssue", input },
        Effect.sync(() => {
          created++;
          return ticketFor(`OLI-${String(41 + created)}`);
        }),
      ),
    describeIssue: (ticket, description) =>
      record({ method: "describeIssue", ticket, description }, Effect.void),
    listBacklog: record({ method: "listBacklog" }, Effect.succeed(options.backlog ?? [])),
  };
  const overrides = options.overrides ?? {};
  const service: Linear.LinearService = {
    teamId: overrides.teamId ?? defaults.teamId,
    labelIds: overrides.labelIds ?? defaults.labelIds,
    assigneeId: overrides.assigneeId ?? defaults.assigneeId,
    createIssue: overrides.createIssue ?? defaults.createIssue,
    describeIssue: overrides.describeIssue ?? defaults.describeIssue,
    listBacklog: overrides.listBacklog ?? defaults.listBacklog,
  };
  return { calls, layer: Layer.succeed(Linear.Linear)(service) };
};
