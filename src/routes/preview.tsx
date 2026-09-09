import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { PreviewShell } from "@/components/preview/PreviewShell";
import { getPreviewRoutesEnabledFn } from "@/lib/preview/preview.functions";

export const Route = createFileRoute("/preview")({
  beforeLoad: async () => {
    const enabled = await getPreviewRoutesEnabledFn();
    if (!enabled) {
      throw notFound();
    }
  },
  component: PreviewLayout,
});

function PreviewLayout() {
  return (
    <PreviewShell>
      <Outlet />
    </PreviewShell>
  );
}
