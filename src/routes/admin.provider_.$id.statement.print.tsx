import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdminProviderStatementPrint } from "@/components/admin/AdminProviderStatementPrint";

export const Route = createFileRoute("/admin/provider_/$id/statement/print")({
  validateSearch: (search: Record<string, unknown>): { from?: string; to?: string } => ({
    ...(typeof search.from === "string" ? { from: search.from } : {}),
    ...(typeof search.to === "string" ? { to: search.to } : {}),
  }),
  component: AdminProviderStatementPrintRoute,
});

function AdminProviderStatementPrintRoute() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { from, to } = Route.useSearch();
  if (!from || !to) {
    return <p className="p-6 text-sm">{t("admin.statement.printRangeRequired")}</p>;
  }
  return <AdminProviderStatementPrint providerId={id} from={from} to={to} />;
}