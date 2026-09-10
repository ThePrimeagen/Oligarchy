import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as Signature from "../../src/automation-server/signature.ts";

const SECRET = "whsec_test";
const BODY = new TextEncoder().encode('{"action":"update","type":"Issue"}');

const sign = (secret: string, body: Uint8Array): string =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("Signature.matches", () => {
  it("accepts Linear's hex HMAC-SHA256 of the raw body", () => {
    expect(Signature.matches(SECRET, sign(SECRET, BODY), BODY)).toBe(true);
  });

  it("rejects a missing, empty, non-hex, short, odd-length or wrong signature, and a different body or secret", () => {
    const good = sign(SECRET, BODY);
    expect(Signature.matches(SECRET, undefined, BODY)).toBe(false);
    expect(Signature.matches(SECRET, "", BODY)).toBe(false);
    expect(Signature.matches(SECRET, "not-hex", BODY)).toBe(false);
    expect(Signature.matches(SECRET, good.slice(0, 16), BODY)).toBe(false);
    expect(Signature.matches(SECRET, `${good}f`, BODY)).toBe(false);
    expect(Signature.matches(SECRET, "00".repeat(32), BODY)).toBe(false);
    expect(Signature.matches(SECRET, good, new TextEncoder().encode("{}"))).toBe(false);
    expect(Signature.matches("other", good, BODY)).toBe(false);
  });
});
