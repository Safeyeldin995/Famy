import { describe, expect, it } from "vitest";
import { needsAdminAction, paymentSituation } from "../paymentSituation";

const cash = (status: string, booking: string) => ({
  status,
  payment_method_type: "cash",
  booking: { status: booking },
});

describe("paymentSituation", () => {
  it("cash on a cancelled or no-show booking owes nothing", () => {
    expect(paymentSituation(cash("pending", "cancelled"))).toBe("noPaymentDue");
    expect(paymentSituation(cash("pending", "no_show"))).toBe("noPaymentDue");
  });

  it("cash on an active booking is collected at the visit", () => {
    for (const b of ["pending", "confirmed", "in_progress", "completion_requested"]) {
      expect(paymentSituation(cash("pending", b))).toBe("cashAtVisit");
    }
  });

  it("completed cash is recorded when the ledger has it, otherwise needs the admin", () => {
    expect(paymentSituation(cash("pending", "completed"), true)).toBe("cashRecorded");
    expect(paymentSituation(cash("pending", "completed"), false)).toBe("cashUnconfirmed");
    expect(needsAdminAction(paymentSituation(cash("pending", "completed")))).toBe(true);
  });

  it("transfers: review with a receipt, waiting without one", () => {
    const transfer = { payment_method_type: "manual_transfer", booking: { status: "completed" } };
    expect(paymentSituation({ ...transfer, status: "pending_review", proof_path: "x" })).toBe(
      "review",
    );
    expect(paymentSituation({ ...transfer, status: "pending" })).toBe("awaitingProof");
    expect(paymentSituation({ method: "instapay", status: "pending_review" })).toBe("awaitingProof");
  });

  it("money received on a cancelled or no-show booking is a refund to make", () => {
    for (const b of ["cancelled", "no_show"]) {
      const card = { status: "captured", payment_method_type: "online", booking: { status: b } };
      expect(paymentSituation(card)).toBe("refundDue");
      const transfer = {
        status: "pending_review",
        payment_method_type: "manual_transfer",
        proof_path: "x",
        booking: { status: b },
      };
      expect(paymentSituation(transfer)).toBe("refundDue");
    }
    expect(needsAdminAction("refundDue")).toBe(true);
    // No receipt uploaded: nothing was sent.
    expect(
      paymentSituation({
        status: "pending_review",
        payment_method_type: "manual_transfer",
        booking: { status: "cancelled" },
      }),
    ).toBe("noPaymentDue");
  });

  it("final payment states win over the booking state", () => {
    expect(paymentSituation(cash("captured", "completed"))).toBe("paid");
    expect(
      paymentSituation({
        status: "rejected",
        payment_method_type: "manual_transfer",
        booking: { status: "cancelled" },
      }),
    ).toBe("rejected");
    expect(paymentSituation({ status: "refunded", payment_method_type: "online" })).toBe(
      "refunded",
    );
  });

  it("online card payment not finished", () => {
    expect(
      paymentSituation({
        status: "pending",
        payment_method_type: "online",
        booking: { status: "confirmed" },
      }),
    ).toBe("awaitingCard");
  });
});
