import { createFileRoute } from "@tanstack/react-router";
import { AdminPayments } from "./admin.payments";

export const Route = createFileRoute("/preview/admin/payments")({
  validateSearch: (search: Record<string, unknown>): { status?: string; statuses?: string } => ({
    ...(typeof search.status === "string" ? { status: search.status } : {}),
    ...(typeof search.statuses === "string" ? { statuses: search.statuses } : {}),
  }),
  component: PreviewAdminPayments,
});

function PreviewAdminPayments() {
  const search = Route.useSearch();
  return <AdminPayments search={search} />;
}
