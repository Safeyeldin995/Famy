import { describe, expect, it } from "vitest";
import { filterSelectableProviderServices } from "@/lib/db/provider-queries";

describe("filterSelectableProviderServices", () => {
  it("keeps only closed-beta active services", () => {
    const rows = [
      { id: "1", category: { slug: "babysitting" } },
      { id: "2", category: { slug: "cleaning" } },
      { id: "3", category: { slug: "tutoring" } },
    ];
    expect(filterSelectableProviderServices(rows).map((row) => row.id)).toEqual(["1", "3"]);
  });
});
