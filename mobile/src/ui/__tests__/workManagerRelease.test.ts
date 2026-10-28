import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../../app.json", import.meta.url), "utf8"));
const properties = config.expo.plugins.find(
  (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
)[1];

describe("Android release shrinking", () => {
  it("keeps Room database constructors that WorkManager creates by reflection at startup", () => {
    expect(properties.android.extraProguardRules).toContain(
      "-keep class * extends androidx.room.RoomDatabase {\n    public <init>();\n}",
    );
    expect(properties.android.extraProguardRules).not.toContain("-dontshrink");
  });
});
