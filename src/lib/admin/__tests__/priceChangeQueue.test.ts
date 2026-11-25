import { describe, expect, it } from "vitest";
import {
  adminPriceChangeKindLabelAr,
  expandAdminPriceChangeQueue,
  type ProviderServicePriceRow,
} from "../priceChangeQueue";

const base: ProviderServicePriceRow = {
  id: "ps-1",
  provider_id: "p-1",
  service_id: "s-1",
  price_override: 300,
  pending_price_override: null,
  online_price_override: 280,
  pending_online_price_override: null,
  price_change_requested_at: "2026-01-02T10:00:00Z",
  online_price_change_requested_at: "2026-01-03T10:00:00Z",
};

describe("expandAdminPriceChangeQueue", () => {
  it("includes in-person and online pending rows separately", () => {
    const items = expandAdminPriceChangeQueue([
      {
        ...base,
        pending_price_override: 350,
        pending_online_price_override: 320,
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.kind).sort()).toEqual(["in_person", "online"]);
    expect(items.find((i) => i.kind === "online")?.pendingAmount).toBe(320);
    expect(items.find((i) => i.kind === "online")?.liveAmount).toBe(280);
  });

  it("labels online requests in Arabic", () => {
    expect(adminPriceChangeKindLabelAr("online")).toBe("سعر أونلاين");
    expect(adminPriceChangeKindLabelAr("in_person")).toBe("سعر حضوري");
  });
});