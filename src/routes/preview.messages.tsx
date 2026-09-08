import { createFileRoute } from "@tanstack/react-router";
import { Route as MessagesRoute } from "./messages.index";

const Messages = MessagesRoute.options.component!;

export const Route = createFileRoute("/preview/messages")({ component: Messages });
