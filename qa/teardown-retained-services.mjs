/**
 * Retained QA services require a conservative two-pass cleanup execute.
 * Pass one removes bookings/users/zones and unreferenced QA services only.
 * Services still referenced at planning time remain retained until pass two.
 */

export const RETAINED_SERVICE_TWO_PASS_POLICY = {
  passOne: [
    "Remove eligible QA users and their owned/co-owned booking graphs.",
    "Remove QA zones and QA services with no remaining booking references.",
    "Retain services blocked by booking-reference-remaining at plan time.",
  ],
  passTwo: [
    "Run a fresh dry-run after pass one completes.",
    "Newly-unreferenced retained services appear in the second plan.",
    "Execute pass two only with the new fingerprint from that dry-run.",
  ],
  fingerprintRule: "Never reuse pass-one fingerprint for pass-two execute.",
};

export function describeRetainedServiceTwoPass(retainedCount) {
  if (!retainedCount) {
    return "No retained QA services — single execute pass is sufficient.";
  }
  return `Pass one retains ${retainedCount} QA service(s) still referenced by bookings. `
    + "After pass one, run a fresh dry-run; pass two requires a new fingerprint.";
}
