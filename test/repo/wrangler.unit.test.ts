import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";

const root = join(import.meta.dirname, "../..");

const Hyperdrive = Schema.Struct({
  binding: Schema.String,
  id: Schema.String,
});

const Wrangler = Schema.Struct({
  hyperdrive: Schema.Array(Hyperdrive),
  env: Schema.Struct({
    local: Schema.Struct({
      hyperdrive: Schema.Array(Hyperdrive),
    }),
  }),
});

const decodeWrangler = Schema.decodeUnknownSync(Wrangler);

const parseJsonc = (text: string): unknown =>
  JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));

describe("wrangler environments", () => {
  const config = decodeWrangler(parseJsonc(readFileSync(join(root, "wrangler.jsonc"), "utf8")));

  it("binds production Hyperdrive at the top level and the shared test Hyperdrive on local", () => {
    expect(config.hyperdrive).toEqual([
      { binding: "HYPERDRIVE", id: "da54bf43f004492996574a6db26d8895" },
    ]);
    expect(config.env.local.hyperdrive).toEqual([
      { binding: "HYPERDRIVE", id: "be7183f62d6e488a9a46fb4d396b8c60" },
    ]);
  });

  it("refuses the same Hyperdrive for local and production", () => {
    expect(config.env.local.hyperdrive[0]?.id).not.toBe(config.hyperdrive[0]?.id);
  });
});
