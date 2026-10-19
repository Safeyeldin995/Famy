import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  payments: [] as any[],
  capture: vi.fn(),
  reject: vi.fn(),
  signed: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ar" } }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (v: unknown) => v,
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock("@/lib/preview/previewPath", () => ({ adminPath: (p: string) => p }));
vi.mock("@/lib/i18n", () => ({ currentLang: () => "ar" }));
vi.mock("@/lib/db/admin-queries", () => ({ useAdminPayments: () => ({ data: h.payments }) }));
vi.mock("@/lib/db/payment-queries", () => ({
  useCapturePayment: () => ({ mutate: h.capture }),
  useRejectPayment: () => ({ mutate: h.reject }),
  getSignedProofUrl: h.signed,
}));
vi.mock("@/components/admin/AdminReasonSheet", () => ({
  AdminReasonSheet: ({ onConfirm }: any) => (
    <button onClick={() => onConfirm("التحويل مش واضح")}>submit reason</button>
  ),
}));
import { AdminPayments } from "../admin.payments";
const payment = {
  id: "p1",
  booking_id: "a1b2c3",
  status: "pending_review",
  payment_method_type: "manual_transfer",
  method: "instapay",
  proof_path: "private/proof",
  amount: 400,
  created_at: "2026-10-13",
  booking: { id: "a1b2c3", status: "completed", customer: { full_name: "عميل" } },
};
beforeEach(() => {
  vi.clearAllMocks();
  h.signed.mockResolvedValue("https://example.invalid/signed-proof");
  h.payments = [payment];
});
afterEach(cleanup);
describe("payment review actions", () => {
  it("requires confirmation and calls only the existing capture path for this row", () => {
    render(<AdminPayments search={{}} />);
    fireEvent.click(screen.getByText("adminOps.confirmTransfer"));
    expect(h.capture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("common.confirm"));
    expect(h.capture).toHaveBeenCalledWith(
      { paymentId: "p1", bookingId: "a1b2c3" },
      expect.any(Object),
    );
  });
  it("rejects through the existing path with the reason", () => {
    render(<AdminPayments search={{}} />);
    fireEvent.click(screen.getByText("adminOps.rejectReason"));
    fireEvent.click(screen.getByText("submit reason"));
    expect(h.reject).toHaveBeenCalledWith(
      { paymentId: "p1", bookingId: "a1b2c3", reason: "التحويل مش واضح" },
      expect.any(Object),
    );
  });
  it("cannot capture an incomplete booking", () => {
    h.payments = [{ ...payment, booking: { ...payment.booking, status: "confirmed" } }];
    render(<AdminPayments search={{}} />);
    expect((screen.getByText("adminOps.confirmTransfer") as HTMLButtonElement).disabled).toBe(true);
  });
  it("historic captured payment has no receipt/reject actions", () => {
    h.payments = [{ ...payment, status: "captured" }];
    render(<AdminPayments search={{ status: "captured" }} />);
    expect(screen.queryByText("adminOps.confirmTransfer")).toBeNull();
    expect(screen.queryByText("adminOps.rejectReason")).toBeNull();
  });
  it("pending proof is fetched from the private signed-URL helper", async () => {
    h.signed.mockResolvedValue("https://example.invalid/signed-proof");
    render(<AdminPayments search={{}} />);
    expect(h.signed).toHaveBeenCalledWith("private/proof");
    expect(await screen.findByRole("img")).toBeTruthy();
  });
});
