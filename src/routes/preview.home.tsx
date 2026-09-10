import { createFileRoute } from "@tanstack/react-router";
import { Route as HomeRoute } from "./home";

const Home = HomeRoute.options.component!;

export const Route = createFileRoute("/preview/home")({ component: Home });
