import { Effect, Layer } from "effect";
import * as Linear from "../../src/ctrl/linear.ts";

export type LinearCall =
  | { readonly method: "teamId" }
  | { readonly method: "labelIds"; readonly teamId: string; readonly version: string }
  | { readonly method: "assigneeId" }
  | { readonly method: "stateIds"; readonly teamId: string }
  | { readonly method: "createIssue"; readonly input: Linear.CreateIssueInput }
  | {
      readonly method: "describeIssue";
      readonly ticket: Linear.LinearTicket;
      readonly description: string;
      readonly stateId: string;
    }
  | {
      readonly method: "moveIssue";
      readonly ticket: Linear.LinearTicket;
      readonly stateId: string;
    }
  | { readonly method: "markReady"; readonly ticket: Linear.LinearTicket }
  | { readonly method: "clearReady"; readonly identifier: string }
  | { readonly method: "listBacklog" }
  | { readonly method: "listAutomationNeeded" }
  | { readonly method: "listNeedsReview" };

export type FakeLinear = {
  readonly calls: Array<LinearCall>;
  readonly layer: Layer.Layer<Linear.Linear>;
};

export const TEAM_ID = "team-id";
export const USER_ID = "user-id";

export const labelId = (name: string): string => `label-${name}`;

export const stateId = (name: string): string => `state-${name}`;

// The two board states `test run` and `mint` hand a ticket through, as the fake answers them.
export const STATES: Linear.WorkflowStateIds = {
  backlog: stateId(Linear.BACKLOG_STATE),
  automationNeeded: stateId(Linear.AUTOMATION_NEEDED_STATE),
};

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
    stateIds: (teamId) => record({ method: "stateIds", teamId }, Effect.succeed(STATES)),
    createIssue: (input) =>
      record(
        { method: "createIssue", input },
        Effect.sync(() => {
          created++;
          return ticketFor(`OLI-${String(41 + created)}`);
        }),
      ),
    describeIssue: (ticket, description, state) =>
      record({ method: "describeIssue", ticket, description, stateId: state }, Effect.void),
    moveIssue: (issue, state) =>
      record({ method: "moveIssue", ticket: issue, stateId: state }, Effect.void),
    markReady: (ticket) => record({ method: "markReady", ticket }, Effect.void),
    clearReady: (identifier) => record({ method: "clearReady", identifier }, Effect.void),
    listBacklog: record({ method: "listBacklog" }, Effect.succeed(options.backlog ?? [])),
    listAutomationNeeded: record({ method: "listAutomationNeeded" }, Effect.succeed([])),
    listNeedsReview: record({ method: "listNeedsReview" }, Effect.succeed([])),
  };
  const overrides = options.overrides ?? {};
  const service: Linear.LinearService = {
    teamId: overrides.teamId ?? defaults.teamId,
    labelIds: overrides.labelIds ?? defaults.labelIds,
    assigneeId: overrides.assigneeId ?? defaults.assigneeId,
    stateIds: overrides.stateIds ?? defaults.stateIds,
    createIssue: overrides.createIssue ?? defaults.createIssue,
    describeIssue: overrides.describeIssue ?? defaults.describeIssue,
    moveIssue: overrides.moveIssue ?? defaults.moveIssue,
    markReady: overrides.markReady ?? defaults.markReady,
    clearReady: overrides.clearReady ?? defaults.clearReady,
    listBacklog: overrides.listBacklog ?? defaults.listBacklog,
    listAutomationNeeded: overrides.listAutomationNeeded ?? defaults.listAutomationNeeded,
    listNeedsReview: overrides.listNeedsReview ?? defaults.listNeedsReview,
  };
  return { calls, layer: Layer.succeed(Linear.Linear)(service) };
};
