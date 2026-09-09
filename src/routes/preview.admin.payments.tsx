import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.payments";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/payments")({ component: Page });
