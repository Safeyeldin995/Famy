import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.reports.online";

const Page = AdminRoute.options.component;

export const Route = createFileRoute("/preview/admin/reports/online")({ component: Page });