import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  transformArJson,
  transformArMarkdown,
  transformQuotedStringsInSource,
} from "../ar-periods.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const targets = [
  {
    path: resolve(repoRoot, "src/lib/i18n/locales/ar.ts"),
    transform: transformQuotedStringsInSource,
  },
  {
    path: resolve(repoRoot, "mobile/locales/ar.json"),
    transform: transformArJson,
  },
  {
    path: resolve(repoRoot, "mobile/store/listing.ar.md"),
    transform: transformArMarkdown,
  },
];

for (const target of targets) {
  const before = readFileSync(target.path, "utf8");
  const after = target.transform(before);
  if (after !== before) {
    writeFileSync(target.path, after);
    console.log(`updated ${target.path}`);
  } else {
    console.log(`unchanged ${target.path}`);
  }
}
