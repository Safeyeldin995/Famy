import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.finance";

const Page = AdminRoute.options.component;

export const Route = createFileRoute("/preview/admin/finance")({ component: Page });
