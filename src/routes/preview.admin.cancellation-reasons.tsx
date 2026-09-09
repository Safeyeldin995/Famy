import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.cancellation-reasons";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/cancellation-reasons")({ component: Page });
