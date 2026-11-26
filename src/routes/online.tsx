import { createFileRoute } from "@tanstack/react-router";
import { OnlineWebLayout } from "@/components/online/OnlineWebLayout";

export const Route = createFileRoute("/online")({
  component: OnlineWebLayout,
});