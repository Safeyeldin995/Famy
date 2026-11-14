import { describe, expect, it } from "vitest";
import ar from "@/lib/i18n/locales/ar";
import {
  balanceSentence,
  ledgerKindLabel,
  ledgerSignedAmount,
  paymentStatusLabel,
  settlementStateLabel,
  settlementTone,
} from "../moneyText";
import { settlementStatusLabel } from "../settlementPresentation";

function tFrom(dict: Record<string, unknown>) {
  return (key: string, opts?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => {
      return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
    }, dict);
    if (typeof value !== "string") return `MISSING:${key}`;
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ""));
  };
}
const t = tFrom(ar as unknown as Record<string, unknown>);
const egp = (n: number) => `${n} ج`;

describe("money glossary (Arabic)", () => {
  it("never shows raw settlement codes for every database status", () => {
    for (const status of ["pending", "paid", "received", "cancelled"]) {
      for (const direction of ["famy_pays_provider", "provider_pays_famy"]) {
        for (const audience of ["admin", "provider"] as const) {
          const label = settlementStateLabel({ status, direction, amount: 100 }, audience, t);
          expect(label).not.toMatch(/MISSING|paid|received|pending|_/);
        }
      }
      expect(settlementStatusLabel(status, t)).not.toMatch(/MISSING|paid|received|pending/);
    }
  });

  it("says who pays whom and whether it happened", () => {
    expect(
      settlementStateLabel({ status: "pending", direction: "famy_pays_provider", amount: 300 }, "admin", t),
    ).toBe("مستحق لمقدم الخدمة");
    expect(
      settlementStateLabel({ status: "paid", direction: "famy_pays_provider", amount: 300 }, "admin", t),
    ).toBe("تم التحويل لمقدم الخدمة");
    expect(
      settlementStateLabel({ status: "received", direction: "provider_pays_famy", amount: 300 }, "provider", t),
    ).toBe("فامي استلمت تحويلك");
    expect(settlementTone({ status: "pending", direction: "provider_pays_famy", amount: 5 })).toBe("pending");
    expect(settlementTone({ status: "paid", direction: "famy_pays_provider", amount: 0 })).toBe("muted");
  });

  it("translates every ledger kind and signs amounts from the provider's side", () => {
    for (const kind of [
      "cash_collected_platform_share",
      "online_provider_share",
      "payout_sent",
      "debt_payment_received",
      "adjustment",
      "something_new",
    ]) {
      expect(ledgerKindLabel(kind, t)).not.toMatch(/MISSING|_/);
    }
    expect(ledgerSignedAmount("credit", 850)).toBe(850);
    expect(ledgerSignedAmount("debit", 150)).toBe(-150);
  });

  it("writes balances as sentences", () => {
    expect(balanceSentence(300, "admin", t, egp)).toBe("مستحق لمقدم الخدمة: 300 ج");
    expect(balanceSentence(-450, "admin", t, egp)).toBe("مستحق على مقدم الخدمة: 450 ج");
    expect(balanceSentence(0, "admin", t, egp)).toBe("لا توجد مستحقات");
  });

  it("has a distinct label for every payment status", () => {
    const statuses = [
      "pending",
      "pending_review",
      "authorized",
      "captured",
      "rejected",
      "failed",
      "refunded",
      "partially_refunded",
    ];
    const labels = statuses.map((s) => paymentStatusLabel(s, t));
    for (const label of labels) expect(label).not.toMatch(/MISSING|_/);
    expect(new Set(labels).size).toBe(statuses.length);
    expect(paymentStatusLabel("weird", t)).toBe("حالة غير معروفة");
  });
});
