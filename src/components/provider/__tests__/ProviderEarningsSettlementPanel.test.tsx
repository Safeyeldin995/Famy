import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ProviderEarningsSettlementPanel } from "../ProviderEarningsSettlementPanel";

const period = {
  period_start: "2026-11-08T08:00:00.000Z",
  period_end: "2026-11-15T08:00:00.000Z",
  next_settlement_at: "2026-11-22T08:00:00.000Z",
};

const capturedKeys: unknown[][] = [];

vi.mock("@/lib/db/provider-settlement-queries", () => ({
  settlementBalanceHeadline: () => "balanced",
  useProviderSettlementBalance: () => ({ data: { net: 0 } }),
  useProviderSettlementPeriod: () => ({ data: period }),
  useProviderSettlements: () => ({ data: [] }),
  useProviderWeekLedgerTotals: vi.fn((providerId: string, bounds: typeof period | undefined) => {
    capturedKeys.push([
      "provider-week-ledger",
      providerId,
      bounds?.period_end,
      bounds?.next_settlement_at,
    ]);
    return { data: { cash: 1, online: 2 }, isLoading: false };
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/components/famio/LanguageToggle", () => ({ useLang: () => "en" }));
vi.mock("@/lib/utils", () => ({ formatEGP: (n: number) => String(n) }));
vi.mock("@/components/famio/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ProviderEarningsSettlementPanel", () => {
  afterEach(() => {
    cleanup();
    capturedKeys.length = 0;
  });

  it("uses a stable week-ledger query key across renders", () => {
    const { rerender } = render(<ProviderEarningsSettlementPanel providerId="p-week" />);
    rerender(<ProviderEarningsSettlementPanel providerId="p-week" />);
    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toEqual(capturedKeys[1]);
    expect(capturedKeys[0]).toEqual([
      "provider-week-ledger",
      "p-week",
      period.period_end,
      period.next_settlement_at,
    ]);
    expect(capturedKeys[0]?.[2]).not.toContain(period.period_start);
  });
});
