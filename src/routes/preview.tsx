import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PreviewShell } from "@/components/preview/PreviewShell";

export const Route = createFileRoute("/preview")({
  component: PreviewLayout,
});

function PreviewLayout() {
  return (
    <PreviewShell>
      <Outlet />
    </PreviewShell>
  );
}
