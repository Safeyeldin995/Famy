import { createFileRoute } from "@tanstack/react-router";
import { Route as ProAvailabilityRoute } from "./pro.availability";

const ProAvailability = ProAvailabilityRoute.options.component!;

export const Route = createFileRoute("/preview/pro/availability")({ component: ProAvailability });
