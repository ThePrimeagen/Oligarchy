import type { CliRenderer, RGBA } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { Deferred, Effect, Exit, Layer, type Scope } from "effect";
import * as Run from "../../src/viz/run.ts";

export type FakeRenderer = {
  readonly layer: Layer.Layer<Run.Renderer>;
  // What the layer's Renderer opens with, for a test that wraps it (a slow opening, say).
  readonly open: Effect.Effect<CliRenderer, never, Scope.Scope>;
  // The screen once the view has opened it: its keys are typed through `mockInput`, its frames
  // read back with `rows`, its size changed with `resize`.
  readonly opened: Effect.Effect<TestRendererSetup>;
  readonly setups: Array<TestRendererSetup>;
};

// A Renderer whose screen is OpenTUI's in-memory test renderer, opened at the given size; the
// release destroys it, which is what hands a real terminal back. Keys arrive in the kitty
// keyboard protocol, as OpenTUI asks a capable terminal for: a lone escape is then a key at
// once, where the legacy parser holds it until its timeout to tell it from a sequence. A
// shifted letter is pressed as the terminal sends it, the letter with the shift modifier.
export const fakeRenderer = (
  size: { readonly columns: number; readonly rows: number } = { columns: 135, rows: 37 },
): FakeRenderer => {
  const setups: Array<TestRendererSetup> = [];
  const first = Deferred.makeUnsafe<TestRendererSetup>();
  const open = Effect.acquireRelease(
    Effect.promise(() =>
      createTestRenderer({ width: size.columns, height: size.rows, kittyKeyboard: true }),
    ).pipe(
      Effect.tap((setup) =>
        Effect.sync(() => {
          setups.push(setup);
          Deferred.doneUnsafe(first, Exit.succeed(setup));
        }),
      ),
      Effect.map((setup) => setup.renderer),
    ),
    (renderer) => Effect.sync(() => renderer.destroy()),
  );
  return {
    layer: Layer.succeed(Run.Renderer)(
      Run.Renderer.of({
        open,
        imageProtocol: Effect.succeed("auto"),
        writeTerminal: () => undefined,
      }),
    ),
    open,
    opened: Deferred.await(first),
    setups,
  };
};

// One render pass, then the screen's rows, each as wide as the screen.
export const rows = (setup: TestRendererSetup): Effect.Effect<ReadonlyArray<string>> =>
  Effect.promise(() => setup.renderOnce()).pipe(
    Effect.map(() => setup.captureCharFrame().replace(/\n$/, "").split("\n")),
  );

export const hex = (color: RGBA): string =>
  `#${color
    .toInts()
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;

// A run of cells drawn alike: its text, its foreground and its attribute bits (bold is 1).
export type Span = readonly [text: string, color: string, attributes: number];

// One render pass, then every row's spans.
export const spans = (
  setup: TestRendererSetup,
): Effect.Effect<ReadonlyArray<ReadonlyArray<Span>>> =>
  Effect.promise(() => setup.renderOnce()).pipe(
    Effect.map(() =>
      setup
        .captureSpans()
        .lines.map((line) => line.spans.map((span) => [span.text, hex(span.fg), span.attributes])),
    ),
  );
