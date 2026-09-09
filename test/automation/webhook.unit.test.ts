import { describe, expect, it } from "vitest";
import { Option } from "effect";
import * as Webhook from "../../src/automation/webhook.ts";

const bytes = (json: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(json));

const issue = {
  action: "update",
  type: "Issue",
  data: {
    identifier: "OLI-1063",
    title: "drive the guest",
    state: {
      id: "a9fe2d89-3cb3-47dd-8645-5d224f997134",
      color: "#bec2c8",
      name: "Automation Needed",
      type: "unstarted",
    },
  },
  updatedFrom: { title: "old title" },
} as const;

describe("Webhook.issue", () => {
  it("reads the ticket and the state Linear put on an Issue", () => {
    const parsed = Webhook.issue(bytes(issue));
    expect(Option.isSome(parsed)).toBe(true);
    if (Option.isNone(parsed)) {
      return;
    }
    expect(Webhook.work(parsed.value)).toEqual({
      ticket: "OLI-1063",
      state: "Automation Needed",
      stateId: "a9fe2d89-3cb3-47dd-8645-5d224f997134",
      stateType: "unstarted",
      action: "update",
      stateChanged: false,
    });
  });

  it("marks a create, or an update whose updatedFrom names state, as a state change", () => {
    const created = Webhook.issue(bytes({ ...issue, action: "create", updatedFrom: undefined }));
    expect(Option.isSome(created)).toBe(true);
    if (Option.isSome(created)) {
      expect(Webhook.work(created.value).stateChanged).toBe(true);
    }
    const moved = Webhook.issue(
      bytes({
        ...issue,
        updatedFrom: { state: { id: "old", name: "Todo", type: "unstarted" } },
      }),
    );
    expect(Option.isSome(moved)).toBe(true);
    if (Option.isSome(moved)) {
      expect(Webhook.work(moved.value).stateChanged).toBe(true);
    }
  });

  it("returns none for invalid JSON, a Comment, a missing ticket or state, or a remove without those fields", () => {
    expect(Webhook.issue(new TextEncoder().encode("{bad"))).toEqual(Option.none());
    expect(Webhook.issue(bytes({ action: "update", type: "Comment", data: {} }))).toEqual(
      Option.none(),
    );
    expect(
      Webhook.issue(bytes({ action: "update", type: "Issue", data: { identifier: "OLI-1" } })),
    ).toEqual(Option.none());
    expect(
      Webhook.issue(
        bytes({
          action: "update",
          type: "Issue",
          data: { state: { id: "x", name: "Todo", type: "unstarted" } },
        }),
      ),
    ).toEqual(Option.none());
  });
});

describe("Webhook.queuedAction", () => {
  const base = {
    ticket: "OLI-1063",
    stateId: "a9fe2d89-3cb3-47dd-8645-5d224f997134",
    stateType: "unstarted",
    action: "update" as const,
    stateChanged: true,
  };

  it("queues drive when the state moves to Automation Needed", () => {
    expect(Webhook.queuedAction({ ...base, state: "Automation Needed" })).toEqual(
      Option.some("drive"),
    );
  });

  it("queues diagnose when the state moves to Needs Review", () => {
    expect(
      Webhook.queuedAction({
        ...base,
        state: "Needs Review",
        stateType: "started",
      }),
    ).toEqual(Option.some("diagnose"));
  });

  it("queues nothing when the state did not change, or is not a queue trigger (unhappy)", () => {
    expect(
      Webhook.queuedAction({ ...base, state: "Automation Needed", stateChanged: false }),
    ).toEqual(Option.none());
    expect(Webhook.queuedAction({ ...base, state: "In Progress", stateType: "started" })).toEqual(
      Option.none(),
    );
    expect(Webhook.queuedAction({ ...base, state: "Done", stateType: "completed" })).toEqual(
      Option.none(),
    );
  });
});
