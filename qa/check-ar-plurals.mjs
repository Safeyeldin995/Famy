import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkArabicLocalePlurals } from "./ar-plurals.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = checkArabicLocalePlurals({
  arTsPath: resolve(repoRoot, "src/lib/i18n/locales/ar.ts"),
});

if (!result.ok) {
  console.error(result.message);
  for (const item of result.missing.slice(0, 30)) {
    console.error(`  missing: ${item}`);
  }
  if (result.missing.length > 30) {
    console.error(`  …and ${result.missing.length - 30} more`);
  }
  process.exit(1);
}

console.log(result.message);
