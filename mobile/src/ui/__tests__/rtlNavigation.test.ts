import { describe, expect, it } from "vitest";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react-native";
import { headerBackIcon, rowChevronIcon } from "../rtlNavigation";

describe("rtl navigation icons", () => {
  it("mirrors list chevrons in Arabic", () => {
    expect(rowChevronIcon("ar")).toBe(ChevronLeft);
    expect(rowChevronIcon("en")).toBe(ChevronRight);
  });

  it("mirrors header back arrows in Arabic", () => {
    expect(headerBackIcon("ar")).toBe(ArrowRight);
    expect(headerBackIcon("en")).toBe(ArrowLeft);
  });
});
