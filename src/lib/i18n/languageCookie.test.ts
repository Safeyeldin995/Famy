import { expect, it } from "vitest";
import { languageCookie, readLanguageCookie } from "./languageCookie";

it("reads only supported languages from the exact cookie name", () => {
  expect(readLanguageCookie("session=example; famio_lang=ar; other=en")).toBe("ar");
  expect(readLanguageCookie("famio_lang=en")).toBe("en");
  expect(readLanguageCookie("other_famio_lang=ar")).toBeUndefined();
  expect(readLanguageCookie("famio_lang=unknown")).toBeUndefined();
  expect(readLanguageCookie("")).toBeUndefined();
});

it("writes a site-wide language cookie lasting one year with SameSite=Lax", () => {
  expect(languageCookie("ar")).toBe("famio_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax");
  expect(readLanguageCookie(languageCookie("en"))).toBe("en");
});
