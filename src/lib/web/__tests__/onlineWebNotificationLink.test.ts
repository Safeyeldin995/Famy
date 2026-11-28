import { describe, expect, it } from "vitest";
import { onlineWebNotificationHref } from "../onlineWebNotificationLink";

describe("onlineWebNotificationHref", () => {
  it("keeps same-site paths", () => {
    expect(onlineWebNotificationHref("/online/lessons/abc")).toBe("/online/lessons/abc");
    expect(onlineWebNotificationHref("/booking/abc#review")).toBe("/booking/abc");
  });
  it("opens a linked student's progress under /online", () => {
    expect(onlineWebNotificationHref("/account/students/abc")).toBe("/online/students/abc");
    expect(onlineWebNotificationHref("/account/students?confirm=self")).toBe(
      "/online/students?confirm=self",
    );
  });
  it("refuses links that could leave the site", () => {
    expect(onlineWebNotificationHref("https://evil.example")).toBeNull();
    expect(onlineWebNotificationHref("//evil.example")).toBeNull();
    expect(onlineWebNotificationHref("/\\evil.example")).toBeNull();
    expect(onlineWebNotificationHref(null)).toBeNull();
  });
});
