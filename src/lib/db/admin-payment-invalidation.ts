import type { QueryClient } from "@tanstack/react-query";

/** Refetch payment queue tabs, counts, and sidebar work-queue after a payment action. */
export function invalidateAdminPaymentQueue(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["admin", "payment-queue"] });
  void qc.invalidateQueries({ queryKey: ["admin", "payment-queue-counts"] });
  void qc.invalidateQueries({ queryKey: ["admin", "work-queue"] });
}