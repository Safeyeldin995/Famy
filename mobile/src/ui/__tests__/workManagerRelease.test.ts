import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// Resolve the installed plugin entry rather than importing a non-exported subpath.
const { updateAndroidProguardRules } = require(
  join(dirname(require.resolve("expo-build-properties")), "android.js"),
);
const config = JSON.parse(readFileSync(new URL("../../../app.json", import.meta.url), "utf8"));
const properties = config.expo.plugins.find(
  (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
)[1];

describe("WorkManager release startup", () => {
  it("preserves the generated database's reflective public constructor without disabling R8", () => {
    expect(properties.android.extraProguardRules).toContain(
      "-keep class androidx.work.impl.WorkDatabase_Impl {\n    public <init>();\n}",
    );
    expect(properties.android.enableMinifyInReleaseBuilds).not.toBe(false);
    expect(properties.android.extraProguardRules).not.toContain("androidx.**");
    expect(properties.android.extraProguardRules).not.toContain("-dontshrink");
  });

  it("uses Expo's generator to retain existing rules and regenerate the targeted keep rule", () => {
    const existing = "# Existing app rule\n-keep class example.Existing { *; }\n";
    const rules = properties.android.extraProguardRules;
    const generated = updateAndroidProguardRules(existing, rules, "append");
    expect(generated).toContain(existing.trim());
    expect(generated).toContain(rules);
    expect(updateAndroidProguardRules(generated, rules, "overwrite")).toBe(generated);
  });
});
