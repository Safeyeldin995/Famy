import { createFileRoute } from "@tanstack/react-router";

const QA_PROJECT_REF = "bfwveoqbyqlhixjvdzha";

function QaMonitoringErrorTrigger({ marker }: { marker: string }): never {
  throw new Error(marker);
}

function QaMonitoringErrorRoute() {
  const { marker } = Route.useSearch();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(QA_PROJECT_REF)) {
    return null;
  }
  return <QaMonitoringErrorTrigger marker={marker ?? "qa_monitoring_boundary_test"} />;
}

export const Route = createFileRoute("/__qa/monitoring-error")({
  validateSearch: (search: Record<string, unknown>) => ({
    marker: typeof search.marker === "string" ? search.marker.slice(0, 120) : undefined,
  }),
  component: QaMonitoringErrorRoute,
});
