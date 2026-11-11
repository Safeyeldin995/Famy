import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Expo writes every non-`ios` key of these files into Android
// res/values-b+<lang>/strings.xml. A key with no default in res/values
// (e.g. CFBundleDisplayName) is an ExtraTranslation, which fails the
// release build's lintVital step. Keep platform keys under `ios`/`android`.
const dir = path.resolve(__dirname, "../../../mobile/locales");

describe.each(["ar", "en"])("mobile/locales/%s.json", (lang) => {
  const json = JSON.parse(readFileSync(path.join(dir, `${lang}.json`), "utf8"));

  it("has only platform sections at the top level", () => {
    expect(Object.keys(json).sort()).toEqual(["android", "ios"]);
  });

  it("only localizes Android keys that have a default resource", () => {
    expect(Object.keys(json.android)).toEqual(["app_name"]);
  });

  it("keeps the iOS display name under ios", () => {
    expect(typeof json.ios.CFBundleDisplayName).toBe("string");
  });
});
