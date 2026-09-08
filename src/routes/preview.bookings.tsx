import { createFileRoute } from "@tanstack/react-router";
import { Route as BookingsRoute } from "./bookings";

const Bookings = BookingsRoute.options.component!;

export const Route = createFileRoute("/preview/bookings")({ component: Bookings });
