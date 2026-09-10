import { createHmac, timingSafeEqual } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/i;

// Linear's Linear-Signature is HMAC-SHA256 of the raw body, hex-encoded. A missing, short, long,
// or non-hex header is a miss, never a throw: timingSafeEqual needs equal-length buffers, and
// Buffer.from(hex) would otherwise drop an unmatched final nibble.
export const matches = (
  secret: string,
  signature: string | undefined,
  body: Uint8Array,
): boolean => {
  if (signature === undefined || !SHA256_HEX.test(signature)) {
    return false;
  }
  const provided = Buffer.from(signature, "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(provided, expected);
};
