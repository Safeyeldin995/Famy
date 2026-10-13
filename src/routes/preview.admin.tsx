import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { seedPreviewAdminQueries } from "@/lib/preview/mockData";

export const Route = createFileRoute("/preview/admin")({
  component: PreviewAdminLayout,
});

function PreviewAdminLayout() {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    seedPreviewAdminQueries(qc);
    qc.setQueryData(["my-role"], "admin");
    setReady(true);
  }, [qc]);

  return (
    <div data-admin-preview-ready={ready}>
      <AdminShell previewMode>
        <Outlet />
      </AdminShell>
    </div>
  );
}
