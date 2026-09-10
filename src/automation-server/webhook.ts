import { Option, Schema } from "effect";
import type * as Automation from "../db/automation.ts";

export const IssueState = Schema.Struct({
  id: Schema.String,
  name: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
}).annotate({ identifier: "@oligarchy/automation-server/webhook/IssueState" });
export type IssueState = typeof IssueState.Type;

export const IssueWebhook = Schema.Struct({
  action: Schema.Literals(["create", "update", "remove"]),
  type: Schema.Literal("Issue"),
  data: Schema.Struct({
    identifier: Schema.NonEmptyString,
    state: IssueState,
  }),
  updatedFrom: Schema.optionalKey(
    Schema.Struct({
      state: Schema.optionalKey(Schema.Unknown),
    }),
  ),
}).annotate({ identifier: "@oligarchy/automation-server/webhook/IssueWebhook" });
export type IssueWebhook = typeof IssueWebhook.Type;

export type Work = {
  readonly ticket: string;
  readonly state: string;
  readonly stateId: string;
  readonly stateType: string;
  readonly action: IssueWebhook["action"];
  readonly stateChanged: boolean;
};

const decodeIssue = Schema.decodeUnknownOption(Schema.fromJsonString(IssueWebhook));

// Linear's body has many keys we do not store yet; the decoder keeps identifier and state
// and whether updatedFrom named state, which is the queue key once rows exist.
export const issue = (body: Uint8Array): Option.Option<IssueWebhook> =>
  decodeIssue(new TextDecoder().decode(body));

export const work = (event: IssueWebhook): Work => ({
  ticket: event.data.identifier,
  state: event.data.state.name,
  stateId: event.data.state.id,
  stateType: event.data.state.type,
  action: event.action,
  stateChanged: event.action === "create" || event.updatedFrom?.state !== undefined,
});

// Status names on the Oligarchy board: Automation Needed starts a drive, Needs Review a diagnose.
export const queuedAction = (event: Work): Option.Option<Automation.AutomationAction> => {
  if (!event.stateChanged) {
    return Option.none();
  }
  if (event.state === "Automation Needed") {
    return Option.some("drive");
  }
  if (event.state === "Needs Review") {
    return Option.some("diagnose");
  }
  return Option.none();
};
