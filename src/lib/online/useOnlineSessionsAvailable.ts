import { useQuery } from "@tanstack/react-query";

export function useOnlineSessionsAvailable() {
  return useQuery({
    queryKey: ["online-sessions-capabilities"],
  staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch("/api/session/capabilities", { credentials: "include" });
      if (!response.ok) return { onlineSessions: false as const };
      const body = (await response.json()) as { onlineSessions?: boolean };
      return { onlineSessions: Boolean(body.onlineSessions) };
    },
  });
}