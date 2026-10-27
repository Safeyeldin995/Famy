// Extend the protected provider fixture in memory to capture provider setup routes.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const sourcePath = path.resolve("qa/provider2-web.cjs");
let source = fs.readFileSync(sourcePath, "utf8");
const before =
  "await expect(page.getByText(ar.mobilePro.notificationPrefs).first()).toBeVisible();";
if (source.split(before).length !== 2) throw new Error("Notification fixture assertion changed");
source = source.replace(
  before,
  "await expect(page.getByText(ar.notifPrefs.title).first()).toBeVisible();",
);
const replaceOnce = (needle, replacement) => {
  if (source.split(needle).length !== 2) throw new Error(`Provider fixture changed near ${needle}`);
  source = source.replace(needle, replacement);
};
replaceOnce(
  "const providerServices = [];",
  `const providerServices = [];
const tutorService = { ...service, id: id(30), slug: "homework-help", name_ar: "مساعدة في الواجب", name_en: "Homework help", allowed_session_durations: [60, 90, 120], category: { slug: "tutoring", name_ar: "تعليم", name_en: "Tutoring" } };
const tutorSubject = { id: id(31), code: "math", name_ar: "رياضيات", name_en: "Math", max_session_duration_min: 120, is_active: true, sort_order: 1 };
const tutorCurriculum = { id: id(32), code: "egyptian", name_ar: "المنهج المصري", name_en: "Egyptian", is_active: true, sort_order: 1 };
const tutorLevel = { id: id(33), code: "g1", name_ar: "الصف الأول", name_en: "Grade 1", is_active: true, sort_order: 1 };`,
);
replaceOnce("services: [service],", "services: [service, tutorService],");
replaceOnce("teaching_subjects: [],", "teaching_subjects: [tutorSubject],");
replaceOnce("teaching_curricula: [],", "teaching_curricula: [tutorCurriculum],");
replaceOnce("teaching_levels: [],", "teaching_levels: [tutorLevel],");
replaceOnce(
  "teaching_subject_services: [],",
  "teaching_subject_services: [{ subject_id: tutorSubject.id, service_id: tutorService.id }],",
);
const marker = "  assert.deepEqual(errors, []);";
if (source.split(marker).length !== 2) throw new Error("Provider fixture shape changed");
source = source.replace(
  marker,
  `
  providerRow = { ...providerDraft };
  providerServices.push({ service_id: tutorService.id, provider_id: pid, status: "pending", price_override: null });
  await visit("/pro-setup-home");
  await shot("setup-home");
  for (const item of ["personal", "about", "hours", "photo", "babysitting", "reference", "subjects"]) {
    await visit(\`/pro-setup/\${item}\`);
    await shot(\`setup-\${item}\`);
  }
  await page.getByRole("button", { name: ar.teaching.subject, exact: true }).click();
  await page.getByRole("radio", { name: tutorSubject.name_ar }).click();
  await page.getByRole("button", { name: ar.teaching.curriculum, exact: true }).click();
  await page.getByRole("radio", { name: tutorCurriculum.name_ar }).click();
  await page.getByRole("button", { name: tutorLevel.name_ar, exact: true }).click();
  await page.getByRole("button", { name: ar.pricePicker.increase, exact: true }).click();
  await page.getByRole("button", { name: ar.providerSetup.saveSubject, exact: true }).click();
  await expect.poll(() => writes.some((write) => write.table === "provider_save_teaching_group")).toBe(true);
${marker}`,
);
process.argv = [
  process.argv[0],
  sourcePath,
  "dist-provider-parity",
  "qa/parity-evidence/provider/native2",
];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(source, sourcePath);
