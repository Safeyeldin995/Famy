import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.campaigns";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/campaigns")({ component: Page });
