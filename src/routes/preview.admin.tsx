import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { seedPreviewAdminQueries } from "@/lib/preview/mockData";

export const Route = createFileRoute("/preview/admin")({
  component: PreviewAdminLayout,
});

function PreviewAdminLayout() {
  const qc = useQueryClient();

  useEffect(() => {
    seedPreviewAdminQueries(qc);
    qc.setQueryData(["my-role"], "admin");
  }, [qc]);

  return (
    <AdminShell previewMode>
      <Outlet />
    </AdminShell>
  );
}
