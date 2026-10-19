/** Pure selection: Vault is authoritative; the environment is a legacy fallback. */
export function resolveWorkerSecret(
  vaultValue: unknown,
  envValue: string | undefined,
): string | undefined {
  return typeof vaultValue === "string" && vaultValue.length > 0
    ? vaultValue
    : envValue || undefined;
}
