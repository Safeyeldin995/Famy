import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.zones";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/zones")({ component: Page });
