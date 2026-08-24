import { createFileRoute } from "@tanstack/react-router";

const QA_PROJECT_REF = "bfwveoqbyqlhixjvdzha";

function QaMonitoringErrorTrigger(): never {
  throw new Error("qa_monitoring_boundary_test");
}

function QaMonitoringErrorRoute() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(QA_PROJECT_REF)) {
    return null;
  }
  return <QaMonitoringErrorTrigger />;
}

export const Route = createFileRoute("/__qa/monitoring-error")({
  component: QaMonitoringErrorRoute,
});
