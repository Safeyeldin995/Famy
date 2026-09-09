import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.index";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/")({ component: Page });
