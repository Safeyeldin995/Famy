import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.payment-methods";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/payment-methods")({ component: Page });
