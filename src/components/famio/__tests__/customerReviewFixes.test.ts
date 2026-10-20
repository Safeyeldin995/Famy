import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customerAreaLabel } from "../customerAreaLabel";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("customer review fixes", () => {
  it("translates area labels without changing stored settings values", () => {
    const labels: Record<string, string> = {
      "customerAreas.sheikhZayed": "الشيخ زايد",
      "customerAreas.october": "6 أكتوبر",
    };
    const areas = ["Sheikh Zayed", "6th of October", "منطقة جديدة"];
    expect(areas.map((area) => customerAreaLabel(area, (key) => labels[key]))).toEqual([
      "الشيخ زايد",
      "6 أكتوبر",
      "منطقة جديدة",
    ]);
    expect(areas).toEqual(["Sheikh Zayed", "6th of October", "منطقة جديدة"]);
    const setup = source("../../../routes/setup.tsx");
    expect(setup).toContain('update("area", a)');
    expect(setup).toContain("area: form.area");
    expect(setup).toContain("customerAreaLabel(a, t)");
    expect(setup).toContain("CustomerPageHeader");
    expect(setup).not.toContain("CustomerPageHero");
  });

  it("keeps party-only calls and emergency support, and hides empty closure cards", () => {
    const booking = source("../../../routes/booking.$id.tsx");
    expect(booking).toContain("useBookingParty(id)");
    expect(booking).toMatch(/party\?\.other_phone &&\s*\(/);
    expect(booking).toContain("tel:$" + "{party.other_phone}");
    expect(booking).toMatch(
      /onClick=\{\(\) => setDialog\("support"\)\}[\s\S]*?bookingDetail.emergency/,
    );
    expect(booking).toMatch(/\(reason \|\| cancellation\) &&\s*\(\s*<Card/);
  });

  it("sets promo/history sizes at the source rather than overriding all spans", () => {
    const home = source("../../../routes/home.tsx");
    expect(home).not.toContain("[&_span]");
    expect(home).toContain("<HomeTrustLine />");
    for (const path of ["../../home/HomePromoStrip.tsx", "../../home/HomeRebookRow.tsx"]) {
      const component = source(path);
      expect(component).not.toMatch(/text-\[(10|11)px\]|text-overline/);
      expect(component).toContain("text-pro-12");
    }
    expect(source("../../home/HomePromoStrip.tsx")).toContain("min-h-11");
  });
});
