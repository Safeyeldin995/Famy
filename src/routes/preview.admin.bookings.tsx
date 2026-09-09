import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.bookings";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/bookings")({ component: Page });
