import { createFileRoute, notFound } from "@tanstack/react-router";
import { OnlineWebLayout } from "@/components/online/OnlineWebLayout";
import { getPreviewRoutesEnabledFn } from "@/lib/preview/preview.functions";

export const Route = createFileRoute("/preview/online")({
  beforeLoad: async () => {
    const enabled = await getPreviewRoutesEnabledFn();
    if (!enabled) {
      throw notFound();
    }
  },
  component: OnlineWebLayout,
});