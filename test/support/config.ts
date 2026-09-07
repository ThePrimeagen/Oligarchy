import { ConfigProvider, Layer } from "effect";

// A ConfigProvider over an explicit record; empty strings count as absent, as in the real env.
export const withEnv = (env: Record<string, string>): Layer.Layer<never> =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
