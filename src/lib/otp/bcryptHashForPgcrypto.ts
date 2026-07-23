import bcrypt from "bcryptjs";

/**
 * PostgreSQL pgcrypto crypt() verifies OpenBSD bcrypt ($2a$).
 * bcryptjs emits $2b$ (and occasionally $2y$); the salt/cost/hash body are compatible
 * once the prefix is normalized.
 */
export function normalizeBcryptHashForPgcrypto(hash: string): string {
  if (hash.startsWith("$2b$") || hash.startsWith("$2y$")) {
    return `$2a$${hash.slice(4)}`;
  }
  return hash;
}

/** Hash an OTP for storage in otp_verifications.otp_hash (pgcrypto-compatible). */
export async function hashOtpForPgcrypto(plaintext: string, rounds: number): Promise<string> {
  const hash = await bcrypt.hash(plaintext, rounds);
  return normalizeBcryptHashForPgcrypto(hash);
}
