import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.operations";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/operations")({ component: Page });
