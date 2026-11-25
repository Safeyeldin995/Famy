import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnlineWebWalkthroughScene } from "@/components/preview/OnlineWebWalkthroughScene";
import {
  isOnlineWalkthroughScene,
  ONLINE_WALKTHROUGH_SCENES,
} from "@/lib/preview/onlineWalkthroughConstants";

const searchSchema = z.object({
  scene: z
    .string()
    .optional()
    .transform((v) => (v && isOnlineWalkthroughScene(v) ? v : "student-home")),
});

export const Route = createFileRoute("/preview/online/walkthrough")({
  validateSearch: searchSchema,
  component: WalkthroughPage,
});

function WalkthroughPage() {
  const { scene } = Route.useSearch();
  return <OnlineWebWalkthroughScene scene={scene} />;
}

export { ONLINE_WALKTHROUGH_SCENES };