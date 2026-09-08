import { createFileRoute } from "@tanstack/react-router";
import { Route as LoginRoute } from "./login";

const Login = LoginRoute.options.component!;

export const Route = createFileRoute("/preview/login")({ component: Login });
