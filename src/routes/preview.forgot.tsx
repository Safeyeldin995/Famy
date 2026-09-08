import { createFileRoute } from "@tanstack/react-router";
import { Route as ForgotRoute } from "./auth.forgot";

const Forgot = ForgotRoute.options.component!;

export const Route = createFileRoute("/preview/forgot")({ component: Forgot });
