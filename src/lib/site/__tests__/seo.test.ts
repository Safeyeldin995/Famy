import { describe, expect, it } from "vitest";
import { SITE_ORIGIN, siteHead, siteLanguage, siteStructuredData } from "../seo";

const copy = {
  ar: { title: "فامي | اختبار", description: "وصف الصفحة" },
  en: { title: "Famy | Test", description: "Page description" },
};

describe("public site SEO", () => {
  it("uses the root SSR language, not global i18n state", () => {
    expect(siteLanguage([{ routeId: "__root__", loaderData: { language: "ar" } }])).toBe("ar");
    expect(siteLanguage([{ routeId: "__root__", loaderData: { language: "en" } }])).toBe("en");
  });

  it("sets a canonical and matching Arabic Open Graph and Twitter metadata", () => {
    const head = siteHead("/about", copy, "ar");
    expect(head.links).toContainEqual({ rel: "canonical", href: `${SITE_ORIGIN}/about` });
    expect(head.meta).toContainEqual({ property: "og:url", content: `${SITE_ORIGIN}/about` });
    expect(head.meta).toContainEqual({ property: "og:locale", content: "ar_EG" });
    expect(head.meta).toContainEqual({ name: "twitter:title", content: copy.ar.title });
  });

  it("structured data contains only the real organization and website", () => {
    expect(siteStructuredData["@graph"].map((item) => item["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
    expect(siteStructuredData["@graph"][0]).toMatchObject({ name: "Famy", url: SITE_ORIGIN });
    expect(JSON.stringify(siteStructuredData)).not.toMatch(/aggregateRating|telephone|address/);
  });
});
