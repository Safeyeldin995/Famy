import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.promo-codes";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/promo-codes")({ component: Page });
