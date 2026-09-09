import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.audit-log";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/audit-log")({ component: Page });
