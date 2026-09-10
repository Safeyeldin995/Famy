import { createFileRoute } from "@tanstack/react-router";
import { Route as ProProfileRoute } from "./pro.profile";

const ProProfile = ProProfileRoute.options.component!;

export const Route = createFileRoute("/preview/pro/profile")({ component: ProProfile });
