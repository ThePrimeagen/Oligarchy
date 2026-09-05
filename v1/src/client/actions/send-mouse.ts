import { Option, Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const UnitInterval = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }, { message: "send-mouse: --x and --y must be in 0..1" }),
);

const flags = {
  sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
  x: Flag.float("x").pipe(Flag.withSchema(UnitInterval), Flag.withDescription("Fraction of the screenshot from the left, 0..1")),
  y: Flag.float("y").pipe(Flag.withSchema(UnitInterval), Flag.withDescription("Fraction of the screenshot from the top, 0..1")),
  button: Flag.choice("button", ["left", "middle", "right", "wheel-up", "wheel-down"]).pipe(
    Flag.optional,
    Flag.withDescription("Omit to move only"),
  ),
  clicks: Flag.integer("clicks").pipe(
    Flag.withSchema(Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))),
    Flag.optional,
    Flag.withDescription("Pulses of --button, default 1"),
  ),
};

export type SendMouseArgs = ClientArgs<typeof flags>;

export async function sendMouseRun(argv: readonly string[]): Promise<void> {
  const args: SendMouseArgs = await parseClientArgs("send-mouse", flags, argv);
  // The proxy moves and ignores clicks when there is no button; say so here instead.
  if (Option.isSome(args.clicks) && Option.isNone(args.button)) {
    throw new Error("send-mouse: --clicks needs --button");
  }
  const body: { id: string; x: number; y: number; agent: string; button?: string; clicks?: number } = {
    id: args.sessionId,
    x: args.x,
    y: args.y,
    agent: args.agentId,
  };
  if (Option.isSome(args.button)) {
    body.button = args.button.value;
  }
  if (Option.isSome(args.clicks)) {
    body.clicks = args.clicks.value;
  }
  await postJSON(args, "/send-mouse", body);
}
