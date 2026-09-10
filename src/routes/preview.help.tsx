import { createFileRoute } from "@tanstack/react-router";
import { Route as HelpRoute } from "./help";

const Help = HelpRoute.options.component!;

export const Route = createFileRoute("/preview/help")({ component: Help });
