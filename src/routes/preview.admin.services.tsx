import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.services";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/services")({ component: Page });
