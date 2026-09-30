import { describe, expect, it } from "vitest";
import {
  classifyAdminCatalogService,
  filterServicesForCatalogView,
  type AdminCatalogServiceRow,
} from "@/lib/admin/adminServiceCatalogViews";

const launchActive: AdminCatalogServiceRow = {
  id: "s-babysit",
  slug: "babysitting",
  is_active: true,
  category: { slug: "babysitting", name_en: "Babysitting" },
};

const launchInactive: AdminCatalogServiceRow = {
  id: "s-tutor-off",
  slug: "tutoring-hourly",
  is_active: false,
  category: { slug: "tutoring", name_en: "Tutoring" },
};

const cleaningReal: AdminCatalogServiceRow = {
  id: "s-deep",
  slug: "deep-home-cleaning",
  is_active: true,
  category: { slug: "home-cleaning", name_en: "Home Cleaning QA_" },
};

const qaFixture: AdminCatalogServiceRow = {
  id: "s-qa",
  slug: "qa-booking-service-1785235277607",
  is_active: true,
  category: { slug: "home-cleaning", name_en: "QA Booking" },
};

describe("classifyAdminCatalogService", () => {
  it("puts babysitting/tutoring non-QA services in launch", () => {
    expect(classifyAdminCatalogService(launchActive)).toBe("launch");
    expect(classifyAdminCatalogService(launchInactive)).toBe("launch");
  });

  it("puts real home cleaning in outside_launch even when category display name contains QA_", () => {
    expect(classifyAdminCatalogService(cleaningReal)).toBe("outside_launch");
  });

  it("puts QA slug fixtures in test_data only", () => {
    expect(classifyAdminCatalogService(qaFixture)).toBe("test_data");
  });
});

describe("filterServicesForCatalogView", () => {
  const all = [launchActive, launchInactive, cleaningReal, qaFixture];

  it("default launch view includes inactive launch services and excludes QA/cleaning", () => {
    const launch = filterServicesForCatalogView(all, "launch");
    expect(launch.map((r) => r.id)).toEqual(["s-babysit", "s-tutor-off"]);
  });

  it("keeps QA rows out of outside_launch", () => {
    const outside = filterServicesForCatalogView(all, "outside_launch");
    expect(outside.map((r) => r.id)).toEqual(["s-deep"]);
    expect(outside.some((r) => isQaRow(r))).toBe(false);
  });

  it("keeps non-QA rows out of test_data", () => {
    const testData = filterServicesForCatalogView(all, "test_data");
    expect(testData.map((r) => r.id)).toEqual(["s-qa"]);
  });
});

function isQaRow(row: AdminCatalogServiceRow) {
  return classifyAdminCatalogService(row) === "test_data";
}

describe("display-name false positive guard", () => {
  it("does not classify Home Cleaning QA_ category name as QA fixture", () => {
    expect(
      classifyAdminCatalogService({
        slug: "regular-home-cleaning",
        category: { slug: "home-cleaning", name_en: "Home Cleaning QA_" },
      }),
    ).toBe("outside_launch");
  });
});
