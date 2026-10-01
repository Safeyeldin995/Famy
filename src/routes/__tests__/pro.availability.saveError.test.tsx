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
    await i18n.changeLanguage("en");
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
