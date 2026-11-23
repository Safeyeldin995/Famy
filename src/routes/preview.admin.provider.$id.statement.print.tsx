import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.provider.$id.statement.print";

const Page = AdminRoute.options.component;

export const Route = createFileRoute("/preview/admin/provider/$id/statement/print")({
  validateSearch: AdminRoute.options.validateSearch,
  component: Page,
});