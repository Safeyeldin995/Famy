import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { adminDate, adminLabel, adminActor, adminErrorSummary } from "../adminPresentation";
import { AdminCustomerCard } from "../AdminCustomerCard";
import { AdminRelativeTime } from "../AdminRelativeTime";
import { adminHref } from "../AdminNavigation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ar" } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, ...props }: any) => (
    <a href={to.replace("$id", params?.id ?? "")} {...props}>
      {children}
    </a>
  ),
}));

describe("admin presentation", () => {
  it("formats Cairo dates independently of a UTC host with Latin digits", () => {
    const previous = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      expect(adminDate("2026-09-01T07:00:00Z")).toBe("1 سبتمبر 2026 · 10 ص");
      expect(adminDate("2026-08-31T22:00:00Z", "ar", false)).toBe("1 سبتمبر 2026");
      expect(adminDate("2026-01-01T08:30:00Z")).toBe("1 يناير 2026 · 10:30 ص");
      expect(adminDate("bad")).toBe("—");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it("maps status, audience, category and actor labels without leaking unknown codes", () => {
    expect(adminLabel("FAILED")).toBe("فشل");
    expect(adminLabel("draft")).toBe("مسودة");
    expect(adminLabel("customers")).toBe("العملاء");
    expect(adminLabel("providers")).toBe("مقدمو الخدمة");
    expect(adminLabel("all")).toBe("الكل");
    expect(adminLabel("cash")).toBe("كاش");
    expect(adminLabel("submit")).toBe("قدم الطلب");
    expect(adminLabel("tutoring")).toBe("دروس خصوصية");
    expect(adminLabel("unrecognized_internal_code")).toBe("unrecognized internal code");
    expect(adminLabel("suspend")).toBe("أوقف الحساب");
    expect(adminLabel(null)).toBe("—");
    expect(adminActor("Admin User")).toBe("الإدارة");
    expect(adminActor("Admin")).toBe("الإدارة");
    expect(adminActor("منى")).toBe("منى");
    expect(adminErrorSummary("Push token expired")).toContain("التوكن");
    expect(adminErrorSummary("Webhook timeout")).toBe("الخدمة اتأخرت في الرد");
    expect(adminErrorSummary("sensitive unknown payload")).not.toContain("payload");
  });
  it("uses explicit preview context, not window state", () => {
    expect(adminHref("/admin/cases", true)).toBe("/preview/admin/cases");
    expect(adminHref("/preview/admin/cases", true)).toBe("/preview/admin/cases");
    expect(adminHref("/admin/cases", false)).toBe("/admin/cases");
    expect(adminHref("/home", true)).toBe("/home");
  });
  it("renders deterministic initial relative-time HTML", () => {
    const first = renderToString(<AdminRelativeTime value="2026-09-01T07:00:00Z" />);
    const clock = vi.spyOn(Date, "now").mockReturnValue(9999999999999);
    expect(renderToString(<AdminRelativeTime value="2026-09-01T07:00:00Z" />)).toBe(first);
    clock.mockRestore();
  });
  it("renders all mobile customer fields without a table and isolates phone direction", () => {
    const { container } = render(
      <AdminCustomerCard
        customer={{
          id: "synthetic",
          full_name: "عميلة تجريبية",
          phone: "+200000000000",
          created_at: "2026-09-01T07:00:00Z",
          totalBookings: 7,
          completedBookings: 4,
          cancelledBookings: 2,
          totalSpent: 1234,
        }}
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByText("+200000000000").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1,234 ج.م")).toBeTruthy();
    expect(screen.getByText("admin.customers.active")).toBeTruthy();
    expect(screen.getByRole("link").className).toContain("min-h-11");
    cleanup();
  });
});
