import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.providers";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/providers")({ component: Page });
