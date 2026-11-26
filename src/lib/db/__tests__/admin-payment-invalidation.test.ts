import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateAdminPaymentQueue } from "../admin-payment-invalidation";

describe("invalidateAdminPaymentQueue", () => {
  it("invalidates payment-queue, payment-queue-counts, and work-queue keys", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidateAdminPaymentQueue(qc);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "payment-queue"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "payment-queue-counts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "work-queue"] });
    expect(spy.mock.calls).toHaveLength(3);
  });
});