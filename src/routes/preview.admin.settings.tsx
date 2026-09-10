import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.settings";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/settings")({ component: Page });
