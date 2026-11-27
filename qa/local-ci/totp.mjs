// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the format Supabase Auth issues.
// Local CI only: computes the admin's second-factor code from the seeded secret.
import crypto from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** @param {string} secret base32 */
function base32Decode(secret) {
  const clean = secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error("[totp] invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * @param {string} secret base32 secret from mfa.enroll()
 * @param {number} [atMs]
 */
export function totpCode(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** Milliseconds left in the current 30 s window. */
export function totpWindowRemainingMs(atMs = Date.now()) {
  return 30_000 - (atMs % 30_000);
}
