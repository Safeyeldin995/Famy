import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.customers";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/customers")({ component: Page });
