import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";

const saveState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
}));

const availabilityData = vi.hoisted(() => [
  { weekday: 1, start_time: "09:00:00", end_time: "17:00:00" },
]);

const emptyList = vi.hoisted(() => [] as const);

const provider = vi.hoisted(() => ({
  id: "prov-1",
  vacation_mode: false,
  buffer_minutes: 30,
  min_notice_hours: 4,
  max_advance_days: 60,
}));

vi.mock("lucide-react", () => ({
  Plane: () => null,
  Trash2: () => null,
  Plus: () => null,
  Timer: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: unknown }) => opts,
}));

vi.mock("@/components/famio/ProviderShell", () => ({
  ProviderShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/famio/ProviderPageHero", () => ({
  ProviderPageHero: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/famio/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PrimaryButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/famio/QueryError", () => ({
  QueryError: () => null,
}));

vi.mock("@/lib/db/provider-queries", () => ({
  useMyProvider: () => ({
    data: provider,
    isLoading: false,
    isError: false,
  }),
  useProviderAvailability: () => ({
    data: availabilityData,
    isError: false,
    refetch: vi.fn(),
  }),
  useReplaceAvailability: () => saveState,
  useUpdateProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderVacations: () => ({ data: emptyList, isError: false, refetch: vi.fn() }),
  useAddVacation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteVacation: () => ({ mutate: vi.fn() }),
  useProviderExceptions: () => ({ data: emptyList, isError: false, refetch: vi.fn() }),
  useAddException: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteException: () => ({ mutate: vi.fn() }),
}));

import { AvailabilityPage } from "@/routes/pro.availability";

describe("provider weekly availability save error", () => {
  afterEach(async () => {
    cleanup();
    saveState.mutate.mockReset();
    saveState.isPending = false;
    saveState.isSuccess = false;
    saveState.isError = false;
    provider.vacation_mode = false;
    await i18n.changeLanguage("en");
  });

  it("exposes active vacation mode with a 44px toggle", () => {
    provider.vacation_mode = true;
    const { container } = render(<AvailabilityPage />);
    expect(container.querySelector("details")?.open).toBe(true);
    const toggle = screen.getByRole("button", { name: i18n.t("pro.schedule.vacationMode") });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.className).toContain("h-11");
    expect(toggle.className).toContain("w-12");
    expect(toggle.className).toContain("shrink-0");
  });

  it("copies 24:00 only after Apply and saves only after the explicit Save button", () => {
    const { container } = render(<AvailabilityPage />);
    const dayName = (day: string) => i18n.t(`pro.schedule.days.${day}`);
    const monday = screen.getByRole("button", { name: dayName("mon") });
    expect(monday.className).toContain("min-h-11");
    expect(monday.className).toContain("min-w-11");
    expect(monday.className).toContain("shrink-0");
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: dayName("tue") }));
    fireEvent.change(screen.getByLabelText(`${dayName("mon")}: ${i18n.t("pro.schedule.start")}`), { target: { value: "18:00" } });
    fireEvent.click(screen.getAllByRole("checkbox", { name: i18n.t("packages.endOfDay") })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: i18n.t("pro.schedule.copyHours") })[0]);
    expect((screen.getByRole("checkbox", { name: dayName("wed") }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: dayName("tue") }));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("pro.schedule.applyCopy") }));
    expect(saveState.mutate).not.toHaveBeenCalled();
    expect((screen.getAllByRole("checkbox", { name: i18n.t("packages.endOfDay") })[2] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("pro.schedule.saveSchedule") }));
    expect(saveState.mutate).toHaveBeenCalledWith({ providerId: "prov-1", rules: [
      { weekday: 1, start_time: "18:00", end_time: "24:00" },
      { weekday: 2, start_time: "18:00", end_time: "24:00" },
    ] });
  });

  it("shows the translated error, not Saved, and keeps unsaved form values", async () => {
    const { rerender } = render(<AvailabilityPage />);

    const mondayStart = screen.getAllByDisplayValue("09:00")[1];
    fireEvent.change(mondayStart, { target: { value: "10:00" } });
    expect((screen.getAllByDisplayValue("10:00")[0] as HTMLInputElement).value).toBe("10:00");

    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(saveState.mutate).toHaveBeenCalledWith({
      providerId: "prov-1",
      rules: [{ weekday: 1, start_time: "10:00", end_time: "17:00" }],
    });

    saveState.isError = true;
    saveState.isSuccess = false;
    rerender(<AvailabilityPage />);

    expect(screen.getByRole("alert").textContent).toBe(
      "Could not save your weekly hours. Your previous schedule was kept.",
    );
    expect(screen.queryByText("Saved")).toBeNull();
    expect((screen.getAllByDisplayValue("10:00")[0] as HTMLInputElement).value).toBe("10:00");

    await i18n.changeLanguage("ar");
    rerender(<AvailabilityPage />);
    expect(screen.getByRole("alert").textContent).toBe(
      "تعذر حفظ ساعاتك الأسبوعية. تم الاحتفاظ بجدولك السابق.",
    );
    expect(screen.queryByText("تم الحفظ")).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
    expect((screen.getAllByDisplayValue("10:00")[0] as HTMLInputElement).value).toBe("10:00");
  });
});
