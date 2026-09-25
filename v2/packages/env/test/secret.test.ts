import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import * as Secret from "../src/secret.ts";

const SENTINEL = "s3cr3t-sentinel-value";

describe("Secret", () => {
  it("reveals the value to the caller that asks for it (happy)", () => {
    expect(new Secret.Secret(SENTINEL).reveal()).toBe(SENTINEL);
  });

  it("never renders the value, however it is printed (unhappy)", () => {
    const secret = new Secret.Secret(SENTINEL);
    const renderings = [
      String(secret),
      JSON.stringify({ secret }),
      inspect(secret),
      inspect({ nested: { secret } }),
    ];
    for (const rendered of renderings) {
      expect(rendered).not.toContain(SENTINEL);
    }
  });
});
