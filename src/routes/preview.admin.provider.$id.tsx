import { createFileRoute } from "@tanstack/react-router";
import { AdminProvider } from "./admin.provider.$id";

export const Route = createFileRoute("/preview/admin/provider/$id")({
  component: PreviewAdminProvider,
});

function PreviewAdminProvider() {
  const { id } = Route.useParams();
  return <AdminProvider id={id} />;
}
