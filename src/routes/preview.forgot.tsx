import { createFileRoute } from "@tanstack/react-router";
import { Forgot } from "./auth.forgot";

export const Route = createFileRoute("/preview/forgot")({
  component: () => <Forgot previewMode />,
});
