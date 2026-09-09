import { createFileRoute } from "@tanstack/react-router";
import { Route as AdminRoute } from "./admin.provider.$id";

const Page = AdminRoute.options.component!;

export const Route = createFileRoute("/preview/admin/provider/$id")({ component: Page });
