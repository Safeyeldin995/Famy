import { createFileRoute } from "@tanstack/react-router";
import { AdminCustomer } from "./admin.customer.$id";

export const Route = createFileRoute("/preview/admin/customer/$id")({
  component: PreviewAdminCustomer,
});

function PreviewAdminCustomer() {
  const { id } = Route.useParams();
  return <AdminCustomer id={id} />;
}
