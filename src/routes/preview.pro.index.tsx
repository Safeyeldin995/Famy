import { createFileRoute } from "@tanstack/react-router";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { ProviderPendingHome } from "@/components/provider/ProviderPendingHome";
import { Route as ProIndexRoute } from "./pro.index";

const ProDashboard = ProIndexRoute.options.component!;

export const Route = createFileRoute("/preview/pro/")({
  validateSearch: (search: Record<string, unknown>): { pending?: 1 | "changes" } =>
    search.pending === "changes" ? { pending: "changes" } : search.pending === 1 || search.pending === "1" ? { pending: 1 } : {},
  component: PreviewProHome,
});

function PreviewProHome() {
  const { pending } = Route.useSearch();
  return pending ? (
    <ProviderShell><ProviderPendingHome preview changesRequested={pending === "changes"} /></ProviderShell>
  ) : <ProDashboard />;
}
