import { createHmac, timingSafeEqual } from "node:crypto";

const HEX = /^[0-9a-f]+$/i;

// Linear's Linear-Signature is HMAC-SHA256 of the raw body, hex-encoded. A missing, short, or
// non-hex header is a miss, never a throw: timingSafeEqual needs equal-length buffers.
export const matches = (secret: string, signature: string | undefined, body: Uint8Array): boolean => {
  if (signature === undefined || !HEX.test(signature)) {
    return false;
  }
  const provided = Buffer.from(signature, "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};
