import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.performance";

const Page = AdminRoute.options.component;

export const Route = createFileRoute("/preview/admin/performance")({ component: Page });
