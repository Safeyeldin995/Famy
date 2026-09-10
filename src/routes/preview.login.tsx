import { createFileRoute } from "@tanstack/react-router";
import { Login } from "./login";

export const Route = createFileRoute("/preview/login")({
  component: () => <Login previewMode />,
});
