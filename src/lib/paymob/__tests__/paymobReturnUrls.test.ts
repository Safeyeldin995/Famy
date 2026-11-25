import { describe, expect, it } from "vitest";
import {
  buildPaymobBookingReturnUrl,
  buildPaymobOnlineWebLessonReturnUrl,
} from "@/lib/paymob/paymobConfig.server";

describe("paymob booking return URLs", () => {
  const origin = "https://famy.app";

  it("keeps native booking return on /booking", () => {
    const url = new URL(buildPaymobBookingReturnUrl(origin, "b1"));
    expect(url.pathname).toBe("/booking/b1");
    expect(url.searchParams.get("paymob_return")).toBe("1");
  });

  it("returns online web checkout to /online/lessons", () => {
    const url = new URL(buildPaymobOnlineWebLessonReturnUrl(origin, "b2"));
    expect(url.pathname).toBe("/online/lessons/b2");
    expect(url.searchParams.get("paymob_return")).toBe("1");
  });
});