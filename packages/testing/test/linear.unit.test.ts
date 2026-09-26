import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as Linear from "@oligarchy/linear/client";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as FakeLinear from "../src/linear.ts";

describe("fakeLinear happy path", () => {
  it.effect("records every call in order and numbers issues from OLI-42", () =>
    Effect.gen(function* () {
      const fake = FakeLinear.fakeLinear();
      const tickets = yield* Effect.gen(function* () {
        const linear = yield* Linear.Linear;
        const teamId = yield* linear.teamId;
        const states = yield* linear.stateIds(teamId);
        const input = { teamId, title: "Omarchy: alpha", labelIds: [], assigneeId: "user-id" };
        const first = yield* linear.createIssue({ ...input, stateId: states.backlog });
        const second = yield* linear.createIssue({ ...input, stateId: states.backlog });
        yield* linear.moveToAborted(second.identifier);
        return [first, second];
      }).pipe(Effect.provide(fake.layer));
      expect(tickets).toEqual([FakeLinear.ticketFor("OLI-42"), FakeLinear.ticketFor("OLI-43")]);
      expect(fake.calls.map((call) => call.method)).toEqual([
        "teamId",
        "stateIds",
        "createIssue",
        "createIssue",
        "moveToAborted",
      ]);
      expect(fake.calls[1]).toEqual({ method: "stateIds", teamId: FakeLinear.TEAM_ID });
    }),
  );
});

describe("fakeLinear unhappy path", () => {
  it.effect("an override answers in place of the default and the calls before it stand", () =>
    Effect.gen(function* () {
      const refused = LinearErrors.LinearError.make({
        operation: "moveToErrored",
        message: "linear: refused",
      });
      const fake = FakeLinear.fakeLinear({
        overrides: { moveToErrored: () => Effect.fail(refused) },
      });
      const error = yield* Effect.gen(function* () {
        const linear = yield* Linear.Linear;
        yield* linear.clearReady("OLI-42");
        return yield* Effect.flip(linear.moveToErrored("OLI-42", "drive errored; boom"));
      }).pipe(Effect.provide(fake.layer));
      expect(error).toBe(refused);
      expect(fake.calls).toEqual([{ method: "clearReady", identifier: "OLI-42" }]);
    }),
  );
});
