import { Deferred, Effect, Layer } from "effect";
import * as Runner from "../../src/automation-client/runner.ts";
import * as Errors from "../../src/shared/errors.ts";

export type Scripted =
  | { readonly _tag: "succeed"; readonly outcome: Runner.RunOutcome }
  | { readonly _tag: "fail"; readonly error: Errors.RunFailed }
  | { readonly _tag: "die"; readonly defect: unknown };

export type FakeRunner = {
  readonly inputs: Array<Runner.RunInput>;
  readonly finalized: Array<boolean>;
  readonly release: Effect.Effect<void>;
  readonly layer: Layer.Layer<Runner.AgentRunner>;
};

// Outcomes are scripted per call. `hold` parks each run on a Deferred until `release`, so a
// test can inspect the live count. Each run records whether its scope's finalizer ran.
export const fakeRunner = (
  options: {
    readonly script?: (input: Runner.RunInput, index: number) => Scripted;
    readonly hold?: boolean;
    readonly name?: string;
    readonly model?: string;
  } = {},
): FakeRunner => {
  const inputs: Array<Runner.RunInput> = [];
  const finalized: Array<boolean> = [];
  const gate = Deferred.makeUnsafe<void>();
  let index = 0;
  const layer = Layer.succeed(Runner.AgentRunner)(
    Runner.AgentRunner.of({
      name: options.name ?? "fake",
      model: options.model ?? "fake-model",
      run: (input) =>
        Effect.gen(function* () {
          const at = index;
          index += 1;
          inputs.push(input);
          finalized[at] = false;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalized[at] = true;
            }),
          );
          if (options.hold === true) {
            yield* Deferred.await(gate);
          }
          const scripted =
            options.script?.(input, at) ??
            ({
              _tag: "succeed",
              outcome: { session: "ses_fake", text: "ok" },
            } satisfies Scripted);
          switch (scripted._tag) {
            case "succeed":
              return scripted.outcome;
            case "fail":
              return yield* scripted.error;
            case "die":
              return yield* Effect.die(scripted.defect);
          }
          return scripted satisfies never;
        }),
    }),
  );
  return {
    inputs,
    finalized,
    release: Effect.asVoid(Deferred.succeed(gate, undefined)),
    layer,
  };
};
