import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import {
  ConfirmCatalogButton,
  catalogDate,
  catalogName,
  catalogTime,
  packageEnd,
} from "../CatalogControls";
import { seedAdminCatalog } from "@/lib/preview/adminCatalog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

describe("admin catalog safety", () => {
  it("does not save on open or cancel; only a confirmed action writes", () => {
    const save = vi.fn();
    render(
      <ConfirmCatalogButton description="Impact" onConfirm={save}>
        Save section
      </ConfirmCatalogButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    expect(screen.getByText("Impact")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));
    fireEvent.click(screen.getByRole("button", { name: "common.confirm" }));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("disables the trigger while a mutation is pending", () => {
    const save = vi.fn();
    render(
      <ConfirmCatalogButton description="Impact" onConfirm={save} disabled>
        Save
      </ConfirmCatalogButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("formats Arabic with Latin digits including a package ending at midnight", () => {
    expect(catalogName({ name_ar: "المعادي", name_en: "Maadi" }, "ar")).toBe("المعادي");
    expect(catalogDate("2027-01-01T12:00:00Z", "ar")).toContain("2027");
    expect(catalogDate("invalid", "ar")).toBe("—");
    expect(catalogTime("18:00", "ar")).toMatch(/6.*م/);
    expect(packageEnd("18:00", 360)).toBe("00:00");
    expect(catalogTime("00:00", "ar")).toMatch(/12.*ص/);
    expect(catalogDate("2027-01-01T12:00:00Z", "ar")).not.toMatch(/[٠-٩]/);
  });
  it("can never change the commission from settings", () => {
    const code = readFileSync("src/routes/admin.settings.tsx", "utf8").replace(/\r\n/g, "\n");
    // VAT and the platform fee are editable; the commission is only ever
    // passed through exactly as stored, and there is no commission input.
    const writes = code.match(/commission_percent:[^\n]*/g) ?? [];
    expect(writes).toEqual(["commission_percent: q.data?.commission_percent ?? null,"]);
    expect(code).not.toMatch(/billing-commission|setCommission/);
    expect(code).toContain('t("adminCatalog.ownerDecision")');
  });
  it("keeps service update behind validation and a separate confirmation", () => {
    const code = readFileSync("src/routes/admin.services.tsx", "utf8").replace(/\r\n/g, "\n");
    const prepare = code.slice(
      code.indexOf("const submitEdit ="),
      code.indexOf("const confirmEdit ="),
    );
    expect(prepare).toContain("validate(editForm");
    expect(prepare).toContain("setPendingEdit(");
    expect(prepare).not.toContain("update.mutate");
    expect(code).toContain("onConfirm={confirmEdit}");
    expect(code).toContain("CatalogConfirm");
  });
  it("seeds admin catalog and optional panels without changing customer caches", () => {
    const qc = new QueryClient();
    qc.setQueryData(["services"], ["untouched"]);
    seedAdminCatalog(qc);
    expect(qc.getQueryData(["services"])).toEqual(["untouched"]);
    expect(qc.getQueryData(["admin", "services"])).toHaveLength(2);
    expect(qc.getQueryData(["teaching-subjects", true])).toHaveLength(1);
    expect(qc.getQueryData(["admin", "promo-codes"])).toMatchObject([
      { usage_count: 3, total_usage_limit: 100 },
    ]);
    expect(qc.getQueryData(["settings", "booking_expiry"])).toBeTruthy();
    expect(qc.getQueryData(["settings", "content", "terms"])).toBeTruthy();
    expect(qc.getQueryData(["admin", "requirements", "catalog-night"])).toEqual([]);
  });
});
