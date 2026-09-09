import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.monitoring";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/monitoring")({ component: Page });
