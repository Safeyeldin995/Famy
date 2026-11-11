import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkArabicLocalePeriods } from "./ar-periods.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = checkArabicLocalePeriods({
  arTsPath: resolve(repoRoot, "src/lib/i18n/locales/ar.ts"),
  arJsonPath: resolve(repoRoot, "mobile/locales/ar.json"),
  listingMdPath: resolve(repoRoot, "mobile/store/listing.ar.md"),
});

if (!result.ok) {
  console.error(result.message);
  for (const item of result.findings.slice(0, 20)) {
    const where = item.path ? `${item.file} (${item.path})` : item.file;
    console.error(`  ${where}: …${item.context}…`);
  }
  if (result.findings.length > 20) {
    console.error(`  …and ${result.findings.length - 20} more`);
  }
  process.exit(1);
}

console.log(result.message);
