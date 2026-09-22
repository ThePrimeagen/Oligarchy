import type { FC } from "hono/jsx";
import { placeOf, stepsOf } from "../viz/steps.ts";
import { FOLLOW_POLL, feedHref, linearHref } from "./ticket.ts";
import type { FollowEvent, SessionFollow } from "./query.ts";
import { since } from "./servers.tsx";

export type { SessionFollow };

// The poll stays on this frame; the feed route replaces only what is inside it, so a swap never
// nests a second poll.
export const FollowFrame: FC<{ follow: SessionFollow }> = ({ follow }) => (
  <div id="follow" hx-get={feedHref(follow.ticket)} hx-trigger={FOLLOW_POLL} hx-swap="innerHTML">
    <FollowBody follow={follow} />
  </div>
);

const Mark: FC<{ state: FollowEvent["state"] }> = ({ state }) => {
  if (state === "completed") {
    return <span class="follow__mark follow__mark--ok">✓</span>;
  }
  if (state === "failed") {
    return <span class="follow__mark follow__mark--bad">✗</span>;
  }
  return <span class="follow__mark">…</span>;
};

const Heading: FC<{ follow: SessionFollow }> = ({ follow }) => (
  <h1 id="follow-heading">
    <a href={linearHref(follow.ticket)}>{follow.ticket}</a>
    {follow.sessionId === null ? null : (
      <>
        {" · "}
        <code>{follow.sessionId}</code>
        {follow.status === null ? null : ` ${follow.status}`}
      </>
    )}
  </h1>
);

// A step line only while an intent is still open and the definition actually lists steps. The
// place is 1-based and walks every intent up to the open one, so a line the list repeats is
// the copy still ahead. An open intent that is not one of those steps is a dash.
const Step: FC<{ follow: SessionFollow }> = ({ follow }) => {
  const steps = stepsOf(follow.instruction);
  const intents = follow.events.flatMap((event) => (event.kind === "intent" ? [event] : []));
  const openAt = intents.findLastIndex((event) => event.state === "running");
  if (steps.length === 0 || openAt === -1) {
    return null;
  }
  const place = placeOf(
    steps,
    intents.slice(0, openAt + 1).map((event) => event.text),
  );
  return (
    <p class="follow__step">
      {place === 0 ? "—" : String(place)}/{String(steps.length)}
    </p>
  );
};

type IntentEvent = Extract<FollowEvent, { kind: "intent" }>;
type ActionEvent = Extract<FollowEvent, { kind: "action" }>;

type IntentionGroup = {
  readonly intent: IntentEvent | null;
  readonly actions: ReadonlyArray<ActionEvent>;
};

// Commands belong to the intention that was open when they were sent. One that was not is its
// own group, so a later intention does not claim it.
const intentionGroups = (events: ReadonlyArray<FollowEvent>): ReadonlyArray<IntentionGroup> => {
  const groups: Array<{ intent: IntentEvent | null; actions: ActionEvent[] }> = [];
  let current: (typeof groups)[number] | undefined;
  for (const event of events) {
    if (event.kind === "intent") {
      current = { intent: event, actions: [] };
      groups.push(current);
      continue;
    }
    if (current === undefined || (current.intent !== null && !event.under)) {
      current = { intent: null, actions: [] };
      groups.push(current);
    }
    current.actions.push(event);
  }
  return groups;
};

const IntentRow: FC<{ event: IntentEvent }> = ({ event }) => (
  <li
    class={event.state === "running" ? "follow__intent follow__intent--running" : "follow__intent"}
  >
    <Mark state={event.state} /> {event.text}
  </li>
);

const ActionRow: FC<{ event: ActionEvent; at: Date }> = ({ event, at }) => (
  <li class={event.under ? "follow__action follow__action--under" : "follow__action"}>
    <Mark state={event.state} /> {event.name} <span class="follow__age">{since(event.at, at)}</span>
  </li>
);

// Newest intention first, and under it the commands taken for it, newest first. Landing shows
// the intention in progress and the action just taken, not the start of the session.
const EventList: FC<{ follow: SessionFollow }> = ({ follow }) => (
  <ol class="follow__log">
    {intentionGroups(follow.events)
      .toReversed()
      .map((group) => (
        <>
          {group.intent === null ? null : <IntentRow event={group.intent} />}
          {group.actions.toReversed().map((event) => (
            <ActionRow event={event} at={follow.queriedAt} />
          ))}
        </>
      ))}
  </ol>
);

const Frame: FC<{ follow: SessionFollow }> = ({ follow }) =>
  follow.imageId === null ? (
    <p>no screenshot yet</p>
  ) : (
    <img
      class="follow__image"
      src={`/images/${follow.imageId}`}
      alt={`Latest frame from ${follow.ticket}`}
    />
  );

// The feed the page paints and the poll swaps in. A session that has not started says so, and
// does not claim there are no commands; a session with nothing sent yet says that plainly.
export const FollowBody: FC<{ follow: SessionFollow }> = ({ follow }) => {
  let body = <Frame follow={follow} />;
  if (follow.sessionId === null) {
    body = follow.waiting ? (
      <p>waiting for {follow.ticket} to start its session</p>
    ) : (
      <p>no session</p>
    );
  } else if (follow.events.length === 0) {
    body = (
      <>
        <Frame follow={follow} />
        <p>no commands yet</p>
      </>
    );
  } else {
    body = (
      <>
        <Frame follow={follow} />
        <EventList follow={follow} />
      </>
    );
  }
  return (
    <>
      <Heading follow={follow} />
      <Step follow={follow} />
      {body}
    </>
  );
};
