import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create, act } from "react-test-renderer";
import {
  isStarFilled,
  ratingLabelKey,
  starRowDirection,
} from "@shared/ui/starRating";

const pressables: Array<{ label: string; onPress?: () => void }> = [];

vi.mock("react-native", async () => {
  const React = await import("react");
  return {
    View: ({ children, style }: { children?: React.ReactNode; style?: object }) =>
      React.createElement("div", { style }, children),
    Pressable: ({
      onPress,
      accessibilityLabel,
      children,
    }: {
      onPress?: () => void;
      accessibilityLabel?: string;
      children?: React.ReactNode;
    }) => {
      pressables.push({ label: accessibilityLabel ?? "", onPress });
      return React.createElement("button", { type: "button", onClick: onPress }, children);
    },
    StyleSheet: { create: (styles: object) => styles },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { n?: number }) => {
      if (key === "mobileBooking.starA11y") return `${opts?.n} من 5 نجوم`;
      if (key === "mobileBooking.starSelectedGroup") return `Selected ${opts?.n}`;
      if (key.startsWith("mobileBooking.starLabel")) return `label-${opts?.n ?? key.slice(-1)}`;
      return key;
    },
    i18n: { language: "ar" },
  }),
}));

vi.mock("lucide-react-native", () => ({
  Star: "Star",
}));

vi.mock("../Text", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

describe("starRating helpers", () => {
  it("mirrors star row direction in Arabic", () => {
    expect(starRowDirection("ar")).toBe("row-reverse");
    expect(starRowDirection("en")).toBe("row");
  });

  it("fills stars up to the selected value", () => {
    expect(isStarFilled(1, 3)).toBe(true);
    expect(isStarFilled(4, 3)).toBe(false);
    expect(isStarFilled(3, 0)).toBe(false);
  });

  it("maps label keys for each star value", () => {
    expect(ratingLabelKey(5)).toBe("mobileBooking.starLabel5");
  });
});

describe("StarRatingInput", () => {
  beforeEach(() => {
    pressables.length = 0;
  });

  it("calls onChange when a star is tapped", async () => {
    const { StarRatingInput } = await import("../StarRatingInput");
    const onChange = vi.fn();
    act(() => {
      create(
        React.createElement(StarRatingInput, {
          label: "Rate",
          value: 0,
          onChange,
        }),
      );
    });
    const star4 = pressables.find((entry) => entry.label === "4 من 5 نجوم");
    expect(star4?.onPress).toBeTypeOf("function");
    act(() => star4!.onPress!());
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
