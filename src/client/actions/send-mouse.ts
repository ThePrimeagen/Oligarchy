import { Option, Schema } from "effect";
import { Argument } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const UnitInterval = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }, { message: "send-mouse: x and y must be in 0..1" }),
);

const flags = {
  id: Argument.string("id"),
  x: Argument.float("x").pipe(Argument.withSchema(UnitInterval)),
  y: Argument.float("y").pipe(Argument.withSchema(UnitInterval)),
  button: Argument.choice("button", ["left", "middle", "right", "wheel-up", "wheel-down"]).pipe(Argument.optional),
  clicks: Argument.integer("clicks").pipe(
    Argument.withSchema(Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))),
    Argument.optional,
  ),
};

export type SendMouseArgs = ClientArgs<typeof flags>;

export async function sendMouseRun(argv: readonly string[]): Promise<void> {
  const args: SendMouseArgs = await parseClientArgs("send-mouse", flags, argv);
  const body: { id: string; x: number; y: number; agent: string; button?: string; clicks?: number } = {
    id: args.id,
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
