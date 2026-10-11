import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { expect, it } from "vitest";

// #143 / #147 in flight. Remove these exemptions in #146.
const ALLOWLIST = new Set([
  "src/routes/pro.availability.tsx",
  "src/components/provider/ProviderSetupForm.tsx",
  "src/routes/book.$providerId.tsx",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

it("keeps pro, provider and famio text at least 12px", () => {
  const files = [
    ...sources("src/routes").filter((file) => /[/\\]pro\.[^/\\]+\.tsx$/.test(file)),
    ...sources("src/components/provider"),
    ...sources("src/components/famio"),
  ];
  const violations = files.filter((file) => {
    const path = relative(process.cwd(), file).replaceAll("\\", "/");
    return (
      !ALLOWLIST.has(path) &&
      /text-\[(?:10|10\.5|11|11\.5)px\]|font-size:\s*(?:10|10\.5|11|11\.5)px/.test(
        readFileSync(file, "utf8"),
      )
    );
  });
  expect(violations).toEqual([]);
});
