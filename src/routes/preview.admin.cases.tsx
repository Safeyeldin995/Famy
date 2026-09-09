import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.cases";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/cases")({ component: Page });
