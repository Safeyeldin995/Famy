import { useQuery } from "@tanstack/react-query";
import { appConfig } from "./supabase";

export function useOnlineSessionsAvailable() {
  return useQuery({
    queryKey: ["online-sessions-capabilities"],
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(
        `${appConfig.webOrigin.replace(/\/$/, "")}/api/session/capabilities`,
        { headers: { "Cache-Control": "no-store" } },
      );
      if (!response.ok) return { onlineSessions: false as const };
      const body = (await response.json()) as { onlineSessions?: boolean };
      return { onlineSessions: Boolean(body.onlineSessions) };
    },
  });
}