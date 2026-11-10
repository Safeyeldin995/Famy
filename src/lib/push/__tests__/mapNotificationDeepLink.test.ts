import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPE_INVENTORY } from "../notificationTypes";
import { mapNotificationDeepLink, workspaceHome } from "../mapNotificationDeepLink";

describe("mapNotificationDeepLink", () => {
  it("falls back to workspace home for empty links", () => {
    expect(mapNotificationDeepLink(null, "customer")).toEqual(workspaceHome("customer"));
    expect(mapNotificationDeepLink("/", "provider")).toEqual(workspaceHome("provider"));
    expect(mapNotificationDeepLink(undefined, "customer")).toEqual({ pathname: "/home" });
  });

  it("maps booking deep links per role", () => {
    expect(mapNotificationDeepLink("/booking/b1", "customer")).toEqual({
      pathname: "/booking/[id]",
      params: { id: "b1" },
    });
    expect(mapNotificationDeepLink("/booking/b1", "provider")).toEqual({ pathname: "/dashboard" });
    expect(mapNotificationDeepLink("/pro/booking/p1", "provider")).toEqual({
      pathname: "/pro-booking/[id]",
      params: { id: "p1" },
    });
    expect(mapNotificationDeepLink("/pro/booking/p1", "customer")).toEqual({ pathname: "/home" });
  });

  it("maps chat thread deep links", () => {
    expect(mapNotificationDeepLink("/messages/conv-1", "customer")).toEqual({
      pathname: "/chat/[id]",
      params: { id: "conv-1" },
    });
    expect(mapNotificationDeepLink("/messages/conv-1", "provider")).toEqual({
      pathname: "/pro-chat/[id]",
      params: { id: "conv-1" },
    });
  });

  it("maps provider onboarding and profile paths", () => {
    expect(mapNotificationDeepLink("/pro/onboarding", "provider")).toEqual({
      pathname: "/pro-onboarding",
    });
    expect(mapNotificationDeepLink("/pro/profile", "provider")).toEqual({ pathname: "/pro-profile" });
    expect(mapNotificationDeepLink("/pro/profile#price-svc", "provider")).toEqual({
      pathname: "/pro-profile",
    });
    expect(mapNotificationDeepLink("/pro/onboarding", "customer")).toEqual({ pathname: "/home" });
  });

  it("maps list and hub routes", () => {
    expect(mapNotificationDeepLink("/notifications", "customer")).toEqual({ pathname: "/notifications" });
    expect(mapNotificationDeepLink("/notifications", "provider")).toEqual({ pathname: "/pro-notifications" });
    expect(mapNotificationDeepLink("/bookings", "customer")).toEqual({ pathname: "/bookings" });
    expect(mapNotificationDeepLink("/pro", "provider")).toEqual({ pathname: "/dashboard" });
    expect(mapNotificationDeepLink("/pro/earnings", "provider")).toEqual({ pathname: "/earnings" });
    expect(mapNotificationDeepLink("/home", "customer")).toEqual({ pathname: "/home" });
  });

  it("covers every inventoried typical deep link pattern without throwing", () => {
    for (const row of NOTIFICATION_TYPE_INVENTORY) {
      const samples = row.typicalDeepLink
        .split(" or ")
        .map((s) =>
          s
            .replace("{id}", "sample-id")
            .replace("{conversationId}", "conv-sample"),
        );
      for (const sample of samples) {
        expect(() => mapNotificationDeepLink(sample, "customer")).not.toThrow();
        expect(() => mapNotificationDeepLink(sample, "provider")).not.toThrow();
      }
    }
  });
});
