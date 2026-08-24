/**
 * Execute path — intentionally not implemented in Stage 1 tooling.
 * Stage 2+ will gate mutations here behind confirm + fingerprint.
 *
 * @param {Awaited<import("./plan.mjs").buildProductionResetPlan>} _plan
 * @param {{ planFingerprint?: string }} _options
 */
export async function runProductionResetExecute(_plan, _options) {
  throw new Error(
    "[production-reset:execute] Not implemented — dry-run only until Stage 2 QA-clone validation and PO approval",
  );
}
