import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { TestConsole } from "effect/testing";
import { CliError } from "effect/unstable/cli";
import * as ClientCommand from "../../src/client/command.ts";
import * as Errors from "../../src/shared/errors.ts";

const stderr = Effect.map(TestConsole.errorLines, (lines) => lines.map(String));

describe("the client's render boundary", () => {
  it.effect("prints nothing for a CliError: Effect already rendered help or the usage error", () =>
    Effect.gen(function* () {
      yield* ClientCommand.report(
        Cause.fail(new CliError.ShowHelp({ commandPath: ["client"], errors: [] })),
      );
      yield* ClientCommand.report(
        Cause.fail(
          new CliError.UnrecognizedOption({
            option: "--session_id",
            command: ["client", "intent", "end"],
            suggestions: [],
          }),
        ),
      );
      expect(yield* stderr).toEqual([]);
      expect(yield* TestConsole.logLines).toEqual([]);
    }),
  );

  it.effect("prints nothing for an interruption", () =>
    Effect.gen(function* () {
      yield* ClientCommand.report(Cause.interrupt());
      expect(yield* stderr).toEqual([]);
    }),
  );

  it.effect("prints a refusal as its headline, then the pretty cause", () =>
    Effect.gen(function* () {
      const cause = Cause.fail(Errors.ProxyRefusal.make({ status: 404, message: "no session" }));
      yield* ClientCommand.report(cause);
      const lines = yield* stderr;
      expect(lines).toHaveLength(1);
      const [headline, ...rest] = (lines[0] ?? "").split("\n");
      expect(headline).toBe("no session");
      expect(rest.join("\n")).toBe(Cause.pretty(cause));
      expect(lines[0]).not.toContain("fetch failed");
    }),
  );

  it.effect("prints a transport failure as `<METHOD> <url> failed: <cause>`", () =>
    Effect.gen(function* () {
      const cause = Cause.fail(
        Errors.ProxyUnreachable.make({
          message: "POST http://127.0.0.1:42069/send-keys failed",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:42069"),
        }),
      );
      yield* ClientCommand.report(cause);
      const [headline] = ((yield* stderr)[0] ?? "").split("\n");
      expect(headline).toBe(
        "POST http://127.0.0.1:42069/send-keys failed: connect ECONNREFUSED 127.0.0.1:42069",
      );
    }),
  );

  it.effect("prints a missing variable with `OLIGARCHY_TOKEN is not set` first", () =>
    Effect.gen(function* () {
      yield* ClientCommand.report(
        Cause.fail(Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" })),
      );
      const [headline] = ((yield* stderr)[0] ?? "").split("\n");
      expect(headline).toBe("OLIGARCHY_TOKEN is not set");
    }),
  );

  it.effect("prints a defect as its pretty cause", () =>
    Effect.gen(function* () {
      const cause = Cause.die(new Error("unexpected"));
      yield* ClientCommand.report(cause);
      const lines = yield* stderr;
      expect(lines).toEqual([`unexpected\n${Cause.pretty(cause)}`]);
    }),
  );
});
