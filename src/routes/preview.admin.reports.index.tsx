import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.reports.index";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/reports/")({ component: Page });
