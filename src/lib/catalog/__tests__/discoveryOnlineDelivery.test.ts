import { describe, expect, it } from "vitest";
import { categoryAllowsOnlineDiscovery } from "../discoveryOnlineDelivery";

describe("categoryAllowsOnlineDiscovery", () => {
  it("allows tutoring groups and search-without-category", () => {
    expect(categoryAllowsOnlineDiscovery(undefined)).toBe(true);
    expect(categoryAllowsOnlineDiscovery("tutoring")).toBe(true);
    expect(categoryAllowsOnlineDiscovery("quran")).toBe(true);
    expect(categoryAllowsOnlineDiscovery("music")).toBe(true);
  });

  it("blocks babysitting", () => {
    expect(categoryAllowsOnlineDiscovery("babysitting")).toBe(false);
  });
});