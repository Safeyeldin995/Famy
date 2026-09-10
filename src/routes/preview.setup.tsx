import { createFileRoute } from "@tanstack/react-router";
import { Route as SetupRoute } from "./setup";

const Setup = SetupRoute.options.component!;

export const Route = createFileRoute("/preview/setup")({ component: Setup });
