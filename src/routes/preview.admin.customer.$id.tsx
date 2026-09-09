import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.customer.$id";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/customer/$id")({ component: Page });
