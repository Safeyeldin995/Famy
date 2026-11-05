import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETE_INTENT,
  isWebSurfacePathAllowed,
  normalizeWebPathname,
} from "../webSurface";

const off = { previewRoutesEnabled: false };
const previewOn = { previewRoutesEnabled: true };

describe("normalizeWebPathname", () => {
  it("strips trailing slashes", () => {
    expect(normalizeWebPathname("/login/")).toBe("/login");
  });
});

describe("isWebSurfacePathAllowed", () => {
  it("allows the landing and static marketing pages", () => {
    for (const path of ["/", "/about", "/contact", "/help", "/content/privacy"]) {
      expect(isWebSurfacePathAllowed(path, {}, off)).toBe(true);
    }
  });

  it("allows admin, staff, provider share, and APIs", () => {
    expect(isWebSurfacePathAllowed("/staff", {}, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/admin/settings", {}, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/provider/abc-123", {}, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/api/mobile/otp/send", {}, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/account/delete", {}, off)).toBe(true);
  });

  it("allows booking only with paymob_return=1", () => {
    expect(isWebSurfacePathAllowed("/booking/book-1", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed("/booking/book-1", { paymob_return: "1" }, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/booking/book-1", "?paymob_return=1", off)).toBe(true);
  });

  it("blocks legacy app routes", () => {
    expect(isWebSurfacePathAllowed("/login", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed("/home", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed("/app", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed("/book/provider-1", {}, off)).toBe(false);
  });

  it("allows account-deletion auth only with intent", () => {
    const intent = { intent: ACCOUNT_DELETE_INTENT };
    expect(isWebSurfacePathAllowed("/login", intent, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/otp", intent, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/auth/forgot", intent, off)).toBe(true);
    expect(isWebSurfacePathAllowed("/login", {}, off)).toBe(false);
  });

  it("allows preview tree only when preview routes are enabled", () => {
    expect(isWebSurfacePathAllowed("/preview/login", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed("/preview/login", {}, previewOn)).toBe(true);
  });
});
