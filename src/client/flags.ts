import { Schema } from "effect";
import * as Flag from "effect/unstable/cli/Flag";
import * as Config from "../config.ts";
import * as Domain from "../shared/domain.ts";

export const DEFAULT_ISO = "omarchy.iso";
export const DEFAULT_ENCODING = "oligarchy";

// Every action takes these two.
export const shared = {
  agentId: Flag.string("agent-id").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("Calling agent's id"),
  ),
  serverUrl: Flag.string("server-url").pipe(
    Flag.withFallbackConfig(Config.serverUrl),
    Flag.withDefault(Config.DEFAULT_SERVER_URL),
    Flag.withDescription("QEMU server URL, used as given; SERVER_URL when omitted"),
  ),
};

export const sessionId = Flag.string("session-id").pipe(
  Flag.withSchema(Schema.NonEmptyString),
  Flag.withDescription("Session id"),
);

export const output = (what: string) =>
  Flag.string("output").pipe(
    Flag.withAlias("o"),
    Flag.optional,
    Flag.withDescription(`Write the ${what} here instead of stdout`),
  );

export const iso = Flag.string("iso").pipe(
  Flag.withDefault(DEFAULT_ISO),
  Flag.withDescription("ISO path or http(s) url"),
);

export const disk = Flag.string("disk").pipe(
  Flag.optional,
  Flag.withDescription("Existing qcow2 path; omit for a fresh disk"),
);

export const server = Flag.string("server").pipe(
  Flag.withSchema(Domain.ServerUrl),
  Flag.optional,
  Flag.withDescription(
    "Reserve on this qemu server (its registered url) instead of the best-ranked one",
  ),
);

export const resume = Flag.boolean("resume").pipe(
  Flag.withDefault(false),
  Flag.withDescription(
    "Boot the machine's minted disk of this iso instead of the iso; refused when there is none",
  ),
);

export const keys = Flag.string("keys").pipe(
  Flag.withDescription('Key string to type, e.g. "hello<ENTER>"'),
);

export const encoding = Flag.string("encoding").pipe(
  Flag.withDefault(DEFAULT_ENCODING),
  Flag.withDescription("Key string encoding"),
);

// A fraction of the screenshot; each flag pair refuses with its own name.
const fraction = (message: string) =>
  Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }, { message }));

const UnitInterval = fraction("mouse: --x and --y must be in 0..1");

export const x = Flag.float("x").pipe(
  Flag.withSchema(UnitInterval),
  Flag.withDescription("Fraction of the screenshot from the left, 0..1"),
);

export const y = Flag.float("y").pipe(
  Flag.withSchema(UnitInterval),
  Flag.withDescription("Fraction of the screenshot from the top, 0..1"),
);

const FromInterval = fraction("mouse drag: --from-x and --from-y must be in 0..1");
const ToInterval = fraction("mouse drag: --to-x and --to-y must be in 0..1");

export const fromX = Flag.float("from-x").pipe(
  Flag.withSchema(FromInterval),
  Flag.withDescription("Where the button goes down, fraction from the left, 0..1"),
);

export const fromY = Flag.float("from-y").pipe(
  Flag.withSchema(FromInterval),
  Flag.withDescription("Where the button goes down, fraction from the top, 0..1"),
);

export const toX = Flag.float("to-x").pipe(
  Flag.withSchema(ToInterval),
  Flag.withDescription("Where the button comes up, fraction from the left, 0..1"),
);

export const toY = Flag.float("to-y").pipe(
  Flag.withSchema(ToInterval),
  Flag.withDescription("Where the button comes up, fraction from the top, 0..1"),
);

export const button = Flag.choice("button", Domain.ClickButton.literals).pipe(
  Flag.withDefault("left"),
  Flag.withDescription("left, middle or right; left when omitted"),
);

export const modifier = Flag.choice("modifier", Domain.MouseModifier.literals).pipe(
  Flag.atMost(Domain.MouseModifier.literals.length),
  Flag.withDescription("Hold this key around the gesture; repeat the flag to hold several"),
);

export const direction = Flag.choice("direction", Domain.ScrollDirection.literals).pipe(
  Flag.withDescription("Which way the wheel turns"),
);

export const ticks = Flag.integer("ticks").pipe(
  Flag.withSchema(
    Schema.Number.check(
      Schema.isBetween(
        { minimum: 1, maximum: 100 },
        { message: "mouse scroll: --ticks must be in 1..100" },
      ),
    ),
  ),
  Flag.withDefault(1),
  Flag.withDescription("How many wheel clicks, 1..100; 1 when omitted"),
);

export const testResultId = Flag.string("test-result-id").pipe(
  Flag.withSchema(Schema.NonEmptyString),
  Flag.withDescription("Test result id from the Linear ticket"),
);

export const message = Flag.string("message").pipe(
  Flag.withSchema(Schema.NonEmptyString),
  Flag.withDescription("What you are about to do"),
);

export const status = Flag.choice("status", Domain.StopStatus.literals).pipe(
  Flag.optional,
  Flag.withDescription("Verdict; omit to abort"),
);

export const reason = Flag.string("reason").pipe(
  Flag.optional,
  Flag.withDescription("Why the session ended"),
);
