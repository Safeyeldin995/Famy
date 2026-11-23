import { createFileRoute } from "@tanstack/react-router";
import { isLiveKitConfigured } from "@/lib/livekit/config.server";

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/session/capabilities")({
  server: {
    handlers: {
      GET: async () => {
        return json({ onlineSessions: isLiveKitConfigured() });
      },
    },
  },
});