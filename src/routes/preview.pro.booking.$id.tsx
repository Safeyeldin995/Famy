import { createFileRoute } from "@tanstack/react-router";
import { Route as ProBookingRoute } from "./pro.booking.$id";

const ProBookingDetail = ProBookingRoute.options.component!;

export const Route = createFileRoute("/preview/pro/booking/$id")({ component: ProBookingDetail });
