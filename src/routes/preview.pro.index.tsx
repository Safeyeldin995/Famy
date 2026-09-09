import { createFileRoute } from "@tanstack/react-router";
import { Route as ProIndexRoute } from "./pro.index";

const ProDashboard = ProIndexRoute.options.component!;

export const Route = createFileRoute("/preview/pro/")({ component: ProDashboard });
