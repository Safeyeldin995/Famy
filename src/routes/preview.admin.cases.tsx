import { createFileRoute } from "@tanstack/react-router";
import { AdminCases } from "./admin.cases";

export const Route = createFileRoute("/preview/admin/cases")({
  validateSearch: (search: Record<string, unknown>): { tab?: string; status?: string } => ({
    ...(typeof search.tab === "string" ? { tab: search.tab } : {}),
    ...(typeof search.status === "string" ? { status: search.status } : {}),
  }),
  component: PreviewAdminCases,
});

function PreviewAdminCases() {
  const search = Route.useSearch();
  return <AdminCases search={search} />;
}
