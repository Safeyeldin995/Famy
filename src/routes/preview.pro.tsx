import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { seedProviderJourney } from "@/lib/provider/previewJourney";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/preview/pro")({
  component: PreviewProLayout,
});

function PreviewProLayout() {
  const qc = useQueryClient();
  useMemo(() => {
    seedProviderJourney(qc);
  }, [qc]);
  return <Outlet />;
}
