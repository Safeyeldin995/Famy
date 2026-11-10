import { describe, expect, it } from "vitest";
import { resolvePostLoginNavigation } from "../resolvePostLoginNavigation";

describe("resolvePostLoginNavigation", () => {
  it("returns the default path when nothing is pending", () => {
    expect(resolvePostLoginNavigation(null, "customer", "/setup")).toBe("/setup");
    expect(resolvePostLoginNavigation(undefined, "provider", "/dashboard")).toBe("/dashboard");
  });

  it("maps a pending push deep link for the signed-in workspace", () => {
    expect(resolvePostLoginNavigation("/booking/b1", "customer", "/home")).toEqual({
      pathname: "/booking/[id]",
      params: { id: "b1" },
    });
    expect(resolvePostLoginNavigation("/pro/booking/p1", "provider", "/dashboard")).toEqual({
      pathname: "/pro-booking/[id]",
      params: { id: "p1" },
    });
  });

  it("prefers pending navigation over customer setup default", () => {
    expect(resolvePostLoginNavigation("/messages/c1", "customer", "/setup")).toEqual({
      pathname: "/chat/[id]",
      params: { id: "c1" },
    });
  });
});
