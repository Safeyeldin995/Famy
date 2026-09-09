import { createFileRoute } from "@tanstack/react-router";
import { Route as ProBookingsRoute } from "./pro.bookings";

const ProBookings = ProBookingsRoute.options.component!;

export const Route = createFileRoute("/preview/pro/bookings")({ component: ProBookings });
