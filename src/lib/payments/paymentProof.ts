/** Ignores null, empty, or whitespace-only transfer receipt paths. */
export function normalizedPaymentProof(proofPath?: string | null): string | null {
  const trimmed = proofPath?.trim();
  return trimmed ? trimmed : null;
}