import { Schema } from "effect";
import { Flag } from "effect/unstable/cli";
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
    Flag.withDescription("Proxy URL, used as given; SERVER_URL when omitted"),
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

export const keys = Flag.string("keys").pipe(
  Flag.withDescription('Key string to type, e.g. "hello<ENTER>"'),
);

export const encoding = Flag.string("encoding").pipe(
  Flag.withDefault(DEFAULT_ENCODING),
  Flag.withDescription("Key string encoding"),
);

const UnitInterval = Schema.Number.check(
  Schema.isBetween(
    { minimum: 0, maximum: 1 },
    { message: "send-mouse: --x and --y must be in 0..1" },
  ),
);

export const x = Flag.float("x").pipe(
  Flag.withSchema(UnitInterval),
  Flag.withDescription("Fraction of the screenshot from the left, 0..1"),
);

export const y = Flag.float("y").pipe(
  Flag.withSchema(UnitInterval),
  Flag.withDescription("Fraction of the screenshot from the top, 0..1"),
);

export const button = Flag.choice("button", Domain.MouseButton.literals).pipe(
  Flag.optional,
  Flag.withDescription("Omit to move only"),
);

export const clicks = Flag.integer("clicks").pipe(
  Flag.withSchema(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  ),
  Flag.optional,
  Flag.withDescription("Pulses of --button, default 1"),
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
