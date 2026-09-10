import { createFileRoute } from "@tanstack/react-router";
import { Route as ProEarningsRoute } from "./pro.earnings";

const ProEarnings = ProEarningsRoute.options.component!;

export const Route = createFileRoute("/preview/pro/earnings")({ component: ProEarnings });
