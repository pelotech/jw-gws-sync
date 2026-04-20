/** Verify Justworks webhook HMAC-SHA256 signature */

/** Convert ArrayBuffer to hex string. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert hex string to Uint8Array. */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verify Justworks webhook HMAC-SHA256 signature.
 * Uses crypto.subtle for HMAC and constant-time comparison via timingSafeEqual.
 * Returns true if signature matches.
 */
export async function verifyWebhookSignature(
  payload: Uint8Array,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expected = await crypto.subtle.sign("HMAC", key, payload as BufferSource);
  const expectedHex = toHex(expected);

  // Both must be the same length for a valid comparison
  if (signature.length !== expectedHex.length) {
    return false;
  }

  // Constant-time comparison using crypto.subtle.timingSafeEqual
  const a = fromHex(expectedHex);
  const b = fromHex(signature);

  // Use Deno's timing-safe comparison
  return timingSafeEqual(a, b);
}

/** Constant-time comparison of two Uint8Arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
