import { describe, expect, it } from "vitest";
import { formatSavedAddressReviewLine, reviewLineForAddressId } from "../savedAddressReviewLine";

describe("savedAddressReviewLine", () => {
  it("formats street, building, compound, and area", () => {
    expect(
      formatSavedAddressReviewLine({
        street: "شارع 1",
        building: "12",
        compound: "كمبوند",
        area: "زايد",
      }),
    ).toBe("شارع 1, 12, كمبوند, زايد");
  });

  it("picks the address row by id for review display", () => {
    const addresses = [
      { id: "a-default", street: "افتراضي", area: "المعادي" },
      { id: "a-rebook", street: "قديم", building: "5", area: "زايد" },
    ];
    expect(reviewLineForAddressId(addresses, "a-rebook")).toBe("قديم, 5, زايد");
    expect(reviewLineForAddressId(addresses, "a-default")).toBe("افتراضي, المعادي");
  });
});
