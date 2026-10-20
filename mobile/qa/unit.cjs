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
    ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  )(
    (name) =>
      name.startsWith("@shared/")
        ? load(path.join(root, "src/lib", name.slice(8) + ".ts"))
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
