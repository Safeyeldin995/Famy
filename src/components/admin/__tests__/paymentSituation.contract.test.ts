import { describe, expect, it } from "vitest";
import { paymentSituation } from "@/components/admin/paymentSituation";
import { paymentSituationFixtures } from "@/lib/payments/paymentSituationFixtures";

describe("paymentSituation contract fixtures", () => {
  it.each(paymentSituationFixtures)("$name", (fixture) => {
    const { ts, expect: situation } = fixture;
    const metadata = "metadata" in fixture ? { ...fixture.metadata } : null;
    expect(
      paymentSituation(
        {
          status: ts.status,
          payment_method_type: ts.payment_method_type,
          method: ts.method,
          proof_path: ts.proof_path,
          booking: ts.booking,
          metadata,
        },
        ts.hasCashLedger,
      ),
    ).toBe(situation);
  });
});