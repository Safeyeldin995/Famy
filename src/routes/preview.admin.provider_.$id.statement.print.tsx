import { createFileRoute } from "@tanstack/react-router";
import { AdminProviderStatementPrint } from "@/components/admin/AdminProviderStatementPrint";

export const Route = createFileRoute("/preview/admin/provider_/$id/statement/print")({
  validateSearch: (search: Record<string, unknown>): { from?: string; to?: string } => ({
    ...(typeof search.from === "string" ? { from: search.from } : {}),
    ...(typeof search.to === "string" ? { to: search.to } : {}),
  }),
  component: PreviewAdminProviderStatementPrintRoute,
});

function PreviewAdminProviderStatementPrintRoute() {
  const { id } = Route.useParams();
  const { from, to } = Route.useSearch();
  if (!from || !to) {
    return <p className="p-6 text-sm">from/to required</p>;
  }
  return <AdminProviderStatementPrint providerId={id} from={from} to={to} />;
}