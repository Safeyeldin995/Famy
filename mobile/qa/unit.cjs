const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("../../node_modules/typescript");
const root = path.resolve(__dirname, "../..");
function load(file) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
  assert(!text.includes("\uFFFD"), `Replacement character in ${file}`);
  const mod = { exports: {} };
  new Function(
    "require",
    "exports",
    "module",
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(
    (name) =>
      name.startsWith("@shared/")
        ? load(path.join(root, "src/lib", name.slice(8) + ".ts"))
        : name.startsWith("@/lib/")
          ? load(path.join(root, "src/lib", name.slice(6) + ".ts"))
          : name.startsWith(".")
            ? load(path.resolve(path.dirname(file), name + ".ts"))
            : require(name),
    mod.exports,
    mod,
  );
  return mod.exports;
}
const { emptyMember, validMember, memberInput } = load(
  path.join(root, "mobile/src/lib/familyForm.ts"),
);
const value = { ...emptyMember(), full_name: "Local fixture", date_of_birth: "2020-02-29" };
assert(validMember(value, false, "2026-10-20"));
assert(!validMember({ ...value, date_of_birth: "2021-02-29" }, false, "2026-10-20"));
assert(!validMember({ ...value, date_of_birth: "2027-01-01" }, false, "2026-10-20"));
assert(!validMember({ ...value, full_name: " " }, false, "2026-10-20"));
assert(
  !validMember({ ...value, relationship: "other", relationship_other: "" }, false, "2026-10-20"),
);
assert(!validMember({ ...value, phone: "123" }, false, "2026-10-20"));
assert(!validMember({ ...value, emergency_contact_name: "Local fixture" }, false, "2026-10-20"));
assert(!validMember({ ...value, allergies: "Local fixture" }, false, "2026-10-20"));
assert(validMember({ ...value, medical_notes: "Local fixture" }, true, "2026-10-20"));
assert.equal(memberInput({ ...value, phone: "01000000000" }).phone, "+201000000000");
const { recentProviders, sortProvidersForStudentEducation } = load(
  path.join(root, "mobile/src/lib/presentation.ts"),
);
assert.deepEqual(
  recentProviders([
    { status: "confirmed", provider: { id: "a" } },
    { status: "completed", provider: { id: "b" } },
    { status: "completed", provider: { id: "b" } },
    { status: "completed", provider: null },
  ]).map((p) => p.id),
  ["b"],
);
assert.deepEqual(
  sortProvidersForStudentEducation(
    [{ id: "a" }, { id: "b" }],
    [{ providerId: "b", status: "approved", serviceId: "s", curriculumId: "c", levelId: "l" }],
    { serviceId: "s", curriculumId: "c", levelId: "l" },
  ).map((p) => p.id),
  ["b", "a"],
);
const en = load(path.join(root, "src/lib/i18n/locales/en.ts")).default;
const ar = load(path.join(root, "src/lib/i18n/locales/ar.ts")).default;
assert.deepEqual(Object.keys(en.mobile).sort(), Object.keys(ar.mobile).sort());
assert(/[\u0600-\u06ff]/.test(ar.mobile.bookingPhase2));
assert(!/[\u064b-\u065f\u0670]/.test(JSON.stringify(ar.mobile)));
console.log("PASS: 15 mobile validation, matching, and locale checks.");

const { buildBookingQuote, buildBookingRequest } = load(
  path.join(root, "src/lib/booking/bookingRequest.ts"),
);
const { bookingScreenMissingStep } = load(path.join(root, "src/lib/booking/bookingScreens.ts"));
const { bookingSubmissionFingerprint, resolveIdempotencyKey } = load(
  path.join(root, "src/lib/booking/idempotency.ts"),
);
const { filterFixedStartSlots, cairoWallTime } = load(
  path.join(root, "src/lib/pricing/servicePackages.ts"),
);
const base = {
  service: { pricing_model: "hourly" },
  rate: 100,
  hours: 4,
  capability: null,
  fee: 25,
  vatPercent: 14,
  requirements: [{ id: "r", fulfillment_mode: "either", provider_extra_fee: 20 }],
  requirementChoices: { r: "provider" },
  travelFee: 10,
  promoDiscount: 30,
};
assert.equal(buildBookingQuote(base).total, 481);
assert.equal(
  buildBookingQuote({ ...base, service: { pricing_model: "fixed", duration_min: 480 }, rate: 800 })
    .subtotal,
  800,
);
assert.equal(
  buildBookingQuote({ ...base, capability: { durationMin: 90, price: 300 } }).subtotal,
  300,
);
assert.equal(buildBookingQuote({ ...base, promoDiscount: 9999 }).total, 0);
const gate = {
  service: true,
  tutoring: false,
  capability: false,
  slot: true,
  address: true,
  recipient: true,
  requirements: true,
  payment: true,
};
assert.equal(bookingScreenMissingStep("review", { ...gate, requirements: false }), "requirements");
assert.equal(
  bookingScreenMissingStep("service", { ...gate, tutoring: true, capability: false }),
  "duration",
);
assert.equal(bookingScreenMissingStep("review", { ...gate, address: false }), "address");
assert.equal(bookingScreenMissingStep("review", { ...gate, payment: false }), "payment");
const request = buildBookingRequest({
  providerId: "p",
  serviceId: "s",
  addressId: "a",
  forWhom: "child",
  start: new Date("2026-11-01T08:00Z"),
  end: new Date("2026-11-01T12:00Z"),
  promoStatus: "applied",
  appliedPromoId: "promo",
  notes: "note",
  eitherRequirements: [{ id: "r" }],
  requirementChoices: { r: "provider" },
  selectedCapability: null,
});
assert.equal(request.family_member_id, "child");
assert.equal(request.promo_code_id, "promo");
assert(!("price_total" in request));
const fingerprint = bookingSubmissionFingerprint(request),
  key = resolveIdempotencyKey(null, fingerprint, () => "key");
assert.equal(
  resolveIdempotencyKey(key, fingerprint, () => {
    throw Error("duplicate");
  }),
  key,
);
assert.equal(
  filterFixedStartSlots(
    [
      { start: cairoWallTime(new Date(2026, 10, 1), "08:00") },
      { start: cairoWallTime(new Date(2026, 10, 1), "09:00") },
    ],
    { pricing_model: "fixed", duration_min: 480, fixed_start_time: "08:00" },
  ).length,
  1,
);
const { planPostCreatePayment, isPaymentEligibleBookingStatus } = load(
  path.join(root, "mobile/src/lib/bookingPure.ts"),
);
assert.equal(
  planPostCreatePayment({ id: "b", fetch_degraded: true }, { id: "m", method_type: "online" })
    .action,
  "defer",
);
assert.equal(
  planPostCreatePayment({ id: "b" }, { id: "m", method_type: "cash" }).action,
  "create_now",
);
assert.equal(isPaymentEligibleBookingStatus("cancelled"), false);
assert.deepEqual(Object.keys(en.mobileBooking).sort(), Object.keys(ar.mobileBooking).sort());
assert(!/[\u064b-\u065f\u0670]/.test(JSON.stringify(ar.mobileBooking)));
console.log(
  "PASS: 18 Phase 2A pricing, payload, gate, idempotency, package, recovery and locale assertions.",
);
