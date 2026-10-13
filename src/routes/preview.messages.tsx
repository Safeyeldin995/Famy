import { createFileRoute } from "@tanstack/react-router";
import { Route as MessagesRoute } from "./messages.index";

import { CustomerPreview } from "./-customerPreview";

const Messages = MessagesRoute.options.component!;

export const Route = createFileRoute("/preview/messages")({ component: () => <CustomerPreview><Messages /></CustomerPreview> });
