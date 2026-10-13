import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n", () => ({ currentLang: () => "en" }));
import { customerProviders } from "../customerProviders";

const row = (id: string, category: string, verified = false) => ({
  id, profile: { full_name: id }, is_top_pro: false, is_verified: verified,
  hourly_rate: 200, ratings: { rating_avg: 0, rating_count: 0 },
  services: [{ status: "approved", service: { category: { slug: category } } }],
});

describe("customer discovery", () => {
  it("keeps eligible providers without top-pro flags or ratings", () => {
    const result = customerProviders([row("sitter", "babysitting"), row("teacher", "tutoring")]);
    expect(result.map((p) => p.id)).toEqual(["sitter", "teacher"]);
    expect(result.every((p) => !p.featured && p.reviews === 0 && !p.avatar)).toBe(true);
  });
  it("keeps both categories on a single card and excludes outside-beta categories", () => {
    const result = customerProviders([row("dual", "babysitting"), row("dual", "tutoring"), row("cleaner", "home-cleaning")]);
    expect(result).toHaveLength(1);
    expect(result[0].categorySlugs).toEqual(["babysitting", "tutoring"]);
  });
  it("only carries an ID verification badge from is_verified", () => {
    expect(customerProviders([row("new", "tutoring")])[0].badges).toEqual([]);
    expect(customerProviders([row("verified", "tutoring", true)])[0].badges).toEqual(["ID Verified"]);
  });
});
