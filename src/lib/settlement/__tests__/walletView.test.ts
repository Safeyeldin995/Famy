import { describe, expect, it } from "vitest";
import {
  transferReference,
  walletBalance,
  walletBookingRows,
  walletState,
  walletTransferRows,
  type WalletLedgerRow,
} from "../walletView";

const ledger: WalletLedgerRow[] = [
  {
    id: "1",
    kind: "cash_collected_platform_share",
    direction: "debit",
    amount: 83,
    booking_id: "b-cash",
    created_at: "2026-11-10T10:00:00Z",
  },
  {
    id: "2",
    kind: "online_provider_share",
    direction: "credit",
    amount: "340",
    booking_id: "b-card",
    created_at: "2026-11-11T10:00:00Z",
  },
  {
    id: "3",
    kind: "debt_payment_received",
    direction: "credit",
    amount: 83,
    note: "ref:IP-55821 ",
    created_at: "2026-11-12T10:00:00Z",
  },
  {
    id: "4",
    kind: "payout_sent",
    direction: "debit",
    amount: 340,
    note: "ref:TR-9",
    created_at: "2026-11-13T10:00:00Z",
  },
];

describe("walletView", () => {
  it("balance matches the server rule (credits minus debits)", () => {
    expect(walletBalance(ledger)).toBe(0);
    expect(walletBalance(ledger.slice(0, 1))).toBe(-83);
    expect(walletBalance(ledger.slice(0, 2))).toBe(257);
  });

  it("booking rows show what the customer paid, Famy's commission and the provider share", () => {
    const rows = walletBookingRows(ledger, {
      "b-cash": {
        id: "b-cash",
        price_total: 253,
        price_provider_net: 170,
        start_at: "2026-11-10T08:00:00Z",
      },
      "b-card": {
        id: "b-card",
        price_total: 400,
        price_provider_net: 340,
        start_at: "2026-11-11T08:00:00Z",
      },
    });
    expect(rows.map((r) => r.bookingId)).toEqual(["b-card", "b-cash"]);
    expect(rows[1]).toMatchObject({
      method: "cash",
      price: 253,
      commission: 83,
      providerNet: 170,
      effect: -83,
    });
    expect(rows[0]).toMatchObject({
      method: "online",
      price: 400,
      commission: 60,
      providerNet: 340,
      effect: 340,
    });
  });

  it("booking rows fall back to the ledger amount when the booking is not loaded", () => {
    const rows = walletBookingRows(ledger, new Map());
    expect(rows.find((r) => r.bookingId === "b-cash")).toMatchObject({
      commission: 83,
      price: null,
    });
    expect(rows.find((r) => r.bookingId === "b-card")).toMatchObject({
      providerNet: 340,
      price: null,
    });
  });

  it("transfers keep only real money moves with their reference", () => {
    const rows = walletTransferRows(ledger);
    expect(rows.map((r) => [r.kind, r.effect, r.reference])).toEqual([
      ["sent", -340, "TR-9"],
      ["received", 83, "IP-55821"],
    ]);
    expect(transferReference("no ref")).toBeNull();
    expect(transferReference("ref:InstaPay 55821 ")).toBe("InstaPay 55821");
    expect(transferReference("ref: ")).toBeNull();
  });

  it("a cancellation fee shows as the provider's earning on that booking", () => {
    const rows = walletBookingRows(
      [
        {
          id: "f",
          kind: "cancellation_fee_provider_share",
          direction: "credit",
          amount: "50",
          booking_id: "b-x",
          created_at: "2026-11-14T10:00:00Z",
        },
      ],
      new Map(),
    );
    expect(rows).toEqual([
      expect.objectContaining({ bookingId: "b-x", method: "fee", providerNet: 50, effect: 50 }),
    ]);
  });

  it("state", () => {
    expect(walletState(0.001)).toBe("even");
    expect(walletState(-83)).toBe("providerOwes");
    expect(walletState(12)).toBe("famyOwes");
  });
});
