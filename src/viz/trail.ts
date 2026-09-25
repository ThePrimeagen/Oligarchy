import { Option } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Follow from "./follow.ts";
import * as Text from "./text.ts";

const INTENT_START = "intent start; ";

// A pull reads more actions than a pane has rows, so the steps under the newest are whole.
export const ACTIONS = Follow.MAX_ENTRIES;

// The selected ticket's session as the database has it, read every LOG_PULL: the step lines
// (`intent start; <message>` and `intent end`, which only the logs record), the newest actions,
// and the last screenshot.
export type Trail = {
  readonly sessionId: string;
  readonly intents: ReadonlyArray<{ readonly text: string; readonly createdAt: Date }>;
  readonly actions: ReadonlyArray<{
    readonly id: number;
    readonly request: unknown;
    readonly state: Domain.ActionState | null;
    readonly createdAt: Date;
    readonly finishedAt: Date | null;
  }>;
  readonly image: Option.Option<{ readonly id: string; readonly png: Uint8Array }>;
};

type Happened =
  | { readonly at: number; readonly _tag: "start"; readonly message: string }
  | { readonly at: number; readonly _tag: "end" }
  | { readonly at: number; readonly _tag: "action"; readonly action: Trail["actions"][number] };

// Steps and actions as one list in the order they happened, a step before an action stamped at
// the same moment. A step stays open until the next starts or it ends, and only while the session
// is live; an action with no verdict is running while the session is live and failed after.
const entriesOf = (trail: Trail, live: boolean): ReadonlyArray<Follow.Entry> => {
  const happened: Array<Happened> = [
    ...trail.intents.map((row): Happened =>
      row.text.startsWith(INTENT_START)
        ? {
            at: row.createdAt.getTime(),
            _tag: "start",
            message: row.text.slice(INTENT_START.length),
          }
        : { at: row.createdAt.getTime(), _tag: "end" },
    ),
    ...trail.actions.map((action): Happened => ({
      at: action.createdAt.getTime(),
      _tag: "action",
      action,
    })),
  ].sort(
    (left, right) =>
      left.at - right.at || Number(left._tag === "action") - Number(right._tag === "action"),
  );
  const entries: Array<Follow.Entry> = [];
  let open = -1;
  const close = (at: number) => {
    if (open !== -1) {
      entries[open] = { ...entries[open], state: "completed", finishedAt: Option.some(at) };
      open = -1;
    }
  };
  for (const event of happened) {
    if (event._tag === "end") {
      close(event.at);
      continue;
    }
    if (event._tag === "start") {
      close(event.at);
      open = entries.length;
      entries.push({
        id: "intent",
        indent: 0,
        name: event.message,
        state: "running",
        startedAt: event.at,
        finishedAt: Option.none(),
      });
      continue;
    }
    const { action } = event;
    entries.push({
      id: action.id,
      indent: entries.some((entry) => entry.id === "intent") ? 2 : 0,
      name: Follow.commandName(action.request),
      state: action.state ?? (live ? "running" : "failed"),
      startedAt: event.at,
      finishedAt: Option.fromNullishOr(action.finishedAt).pipe(Option.map((at) => at.getTime())),
    });
  }
  if (!live && open !== -1) {
    entries[open] = { ...entries[open], state: "completed" };
  }
  return entries;
};

// The newest step wraps so its words stay; an older one is cut to its row.
const header = (
  intent: Follow.Entry,
  newest: boolean,
  glyph: string,
  width: number,
): ReadonlyArray<Text.Row> => {
  const mark = Follow.mark(intent.state, glyph);
  if (!newest) {
    return [[mark, Text.SPACE, Text.strong(Text.cut(intent.name, width - 2))]];
  }
  const lines = Follow.wrap(intent.name, width - 2);
  return (lines.length === 0 ? [""] : lines).map((line, index): Text.Row =>
    index === 0 ? [mark, Text.SPACE, Text.strong(line)] : [{ text: "  " }, Text.strong(line)],
  );
};

// The newest step first, each followed by its actions newest first; the processing that led to
// an action sits just below it, and while nothing runs the time since the last one ended counts
// up at the top. `now` is on the database's clock. Rows past `height` are dropped.
export const rows = (
  trail: Trail,
  now: number,
  live: boolean,
  glyph: string,
  width: number,
  height: number,
): ReadonlyArray<Text.Row> => {
  const groups: Array<{ readonly intent: Follow.Entry | undefined; lines: Array<Follow.Line> }> =
    [];
  for (const line of Follow.timeline(entriesOf(trail, live), now, live)) {
    if (line._tag === "entry" && line.entry.id === "intent") {
      groups.push({ intent: line.entry, lines: [] });
      continue;
    }
    if (groups.length === 0) {
      groups.push({ intent: undefined, lines: [] });
    }
    groups[groups.length - 1].lines.push(line);
  }
  const drawn: Array<Text.Row> = [];
  [...groups].reverse().forEach((group, index) => {
    if (group.intent !== undefined) {
      drawn.push(...header(group.intent, index === 0, glyph, width));
    }
    const indent = group.intent === undefined ? 0 : 2;
    for (const line of [...group.lines].reverse()) {
      drawn.push(Follow.timelineRow(line, glyph, width, indent));
    }
  });
  return drawn.slice(0, height);
};

// Every step said, oldest first, while the newest is still open: what places the running row's
// n/total. Nothing once it has ended or the session is over.
export const steps = (trail: Trail, live: boolean): ReadonlyArray<string> => {
  const newest = trail.intents.at(-1);
  if (!live || newest === undefined || !newest.text.startsWith(INTENT_START)) {
    return [];
  }
  return trail.intents
    .filter((row) => row.text.startsWith(INTENT_START))
    .map((row) => row.text.slice(INTENT_START.length));
};
