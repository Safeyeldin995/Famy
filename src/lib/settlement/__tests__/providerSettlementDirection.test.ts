import { describe, expect, it } from "vitest";
import {
  adminSettlementDirectionLabel,
  providerSettlementDirectionLabel,
} from "../providerSettlementDirection";

describe("settlement direction labels", () => {
  const keys: Record<string, string> = {
    "pro.settlement.directionFamyPays": "فامي هتحولك",
    "pro.settlement.directionYouPay": "مطلوب منك تحول",
    "admin.settlement.directionFamyPays": "فامي تحول للمقدم",
    "admin.settlement.directionProviderPays": "المقدم يحول لفامي",
  };
  const t = (key: string) => keys[key] ?? key;

  it("uses provider copy on provider helper", () => {
    expect(providerSettlementDirectionLabel("famy_pays_provider", t)).toBe("فامي هتحولك");
    expect(providerSettlementDirectionLabel("provider_pays_famy", t)).toBe("مطلوب منك تحول");
  });

  it("uses admin copy on admin helper", () => {
    expect(adminSettlementDirectionLabel("famy_pays_provider", t)).toBe("فامي تحول للمقدم");
    expect(adminSettlementDirectionLabel("provider_pays_famy", t)).toBe("المقدم يحول لفامي");
  });
});
