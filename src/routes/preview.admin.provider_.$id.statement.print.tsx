import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.provider_.$id.statement.print";

const Page = AdminRoute.options.component;

export const Route = createFileRoute("/preview/admin/provider_/$id/statement/print")({
  validateSearch: AdminRoute.options.validateSearch,
  component: Page,
});