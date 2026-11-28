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
    expect(mapNotificationDeepLink("/pro/online-lessons", "provider")).toEqual({
      pathname: "/pro-online-lessons",
    });
    expect(mapNotificationDeepLink("/pro/online-lessons", "customer")).toEqual({
      pathname: "/home",
    });
    expect(mapNotificationDeepLink("/pro/profile", "provider")).toEqual({
      pathname: "/pro-profile",
    });
    expect(mapNotificationDeepLink("/pro/profile#price-svc", "provider")).toEqual({
      pathname: "/pro-profile",
    });
    expect(mapNotificationDeepLink("/pro/onboarding", "customer")).toEqual({ pathname: "/home" });
  });

  it("maps online lesson join, wallet, short provider share, and review query", () => {
    expect(mapNotificationDeepLink("/online/lessons/b1/room", "customer")).toEqual({
      pathname: "/booking/[id]/session",
      params: { id: "b1" },
    });
    expect(mapNotificationDeepLink("/online/lessons/b1", "provider")).toEqual({
      pathname: "/pro-booking/[id]",
      params: { id: "b1" },
    });
    expect(mapNotificationDeepLink("/online/lessons/b1", "customer")).toEqual({
      pathname: "/booking/[id]",
      params: { id: "b1" },
    });
    expect(mapNotificationDeepLink("/online/lessons/b1/room", "provider")).toEqual({
      pathname: "/pro-booking/[id]/session",
      params: { id: "b1" },
    });
    expect(mapNotificationDeepLink("/wallet", "customer")).toEqual({ pathname: "/wallet" });
    expect(mapNotificationDeepLink("/p/prov-1", "customer")).toEqual({
      pathname: "/provider/[id]",
      params: { id: "prov-1" },
    });
    expect(mapNotificationDeepLink("/booking/b1?review=1", "customer")).toEqual({
      pathname: "/booking/[id]",
      params: { id: "b1", review: "1" },
    });
  });

  it("maps wallet and provider setup sections", () => {
    expect(mapNotificationDeepLink("/wallet", "customer")).toEqual({ pathname: "/wallet" });
    expect(mapNotificationDeepLink("/wallet", "provider")).toEqual({ pathname: "/dashboard" });
    expect(mapNotificationDeepLink("/pro/documents", "provider")).toEqual({
      pathname: "/pro-documents",
    });
    expect(mapNotificationDeepLink("/pro/setup/personal", "provider")).toEqual({
      pathname: "/pro-setup/[item]",
      params: { item: "personal" },
    });
    expect(mapNotificationDeepLink("/pro/setup/references", "provider")).toEqual({
      pathname: "/pro-setup/[item]",
      params: { item: "reference" },
    });
  });

  it("maps the student grade confirmation and tutor availability links (issue 536)", () => {
    expect(mapNotificationDeepLink("/account/students?confirm=self", "customer")).toEqual({
      pathname: "/students",
      params: { confirm: "self" },
    });
    expect(mapNotificationDeepLink("/account/students?confirm=kid-1", "customer")).toEqual({
      pathname: "/students",
      params: { confirm: "kid-1" },
    });
    expect(mapNotificationDeepLink("/account/students", "customer")).toEqual({
      pathname: "/students",
    });
    expect(mapNotificationDeepLink("/online/tutors", "customer")).toEqual({
      pathname: "/category/[id]",
      params: { id: "tutoring" },
    });
    expect(mapNotificationDeepLink("/category/tutoring", "customer")).toEqual({
      pathname: "/category/[id]",
      params: { id: "tutoring" },
    });
    expect(mapNotificationDeepLink("/category/quran", "customer")).toEqual({
      pathname: "/category/[id]",
      params: { id: "quran" },
    });
    expect(mapNotificationDeepLink("/category/music", "customer")).toEqual({
      pathname: "/category/[id]",
      params: { id: "music" },
    });
    expect(mapNotificationDeepLink("/account/students", "provider")).toEqual({
      pathname: "/dashboard",
    });
  });

  it("maps list and hub routes", () => {
    expect(mapNotificationDeepLink("/notifications", "customer")).toEqual({
      pathname: "/notifications",
    });
    expect(mapNotificationDeepLink("/notifications", "provider")).toEqual({
      pathname: "/pro-notifications",
    });
    expect(mapNotificationDeepLink("/bookings", "customer")).toEqual({ pathname: "/bookings" });
    expect(mapNotificationDeepLink("/pro", "provider")).toEqual({ pathname: "/dashboard" });
    expect(mapNotificationDeepLink("/pro/earnings", "provider")).toEqual({ pathname: "/earnings" });
    expect(mapNotificationDeepLink("/home", "customer")).toEqual({ pathname: "/home" });
  });

  it("covers every inventoried typical deep link pattern without throwing", () => {
    for (const row of NOTIFICATION_TYPE_INVENTORY) {
      const samples = row.typicalDeepLink
        .split(" or ")
        .map((s) => s.replace("{id}", "sample-id").replace("{conversationId}", "conv-sample"));
      for (const sample of samples) {
        expect(() => mapNotificationDeepLink(sample, "customer")).not.toThrow();
        expect(() => mapNotificationDeepLink(sample, "provider")).not.toThrow();
      }
    }
  });
  it("opens a linked student's progress for a parent", () => {
    expect(mapNotificationDeepLink("/account/students/s1", "customer")).toEqual({
      pathname: "/progress/[id]",
      params: { id: "s1" },
    });
    expect(mapNotificationDeepLink("/account/students/s1", "provider")).toEqual({
      pathname: "/dashboard",
    });
  });
});
