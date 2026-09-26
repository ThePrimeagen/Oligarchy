import { Layer, Tracer } from "effect";

export type Recording = {
  readonly spans: Array<Tracer.NativeSpan>;
  readonly layer: Layer.Layer<never>;
};

// A tracer that keeps every span it creates so tests can read names, parents,
// attributes and the exit each span ended with.
export const recording = (): Recording => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, layer: Layer.succeed(Tracer.Tracer)(tracer) };
};
