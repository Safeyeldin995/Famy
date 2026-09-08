import { QueryClient } from "@tanstack/react-query";
import { seedPreviewQueries } from "@/lib/preview/mockData";

export function installPreviewFetchGuard() {
  if (typeof window === "undefined" || (window as Window & { __famyPreviewFetchGuard?: boolean }).__famyPreviewFetchGuard) {
    return;
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("supabase.co")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
  (window as Window & { __famyPreviewFetchGuard?: boolean }).__famyPreviewFetchGuard = true;
}

export function createPreviewQueryClient() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      },
    },
  });
  seedPreviewQueries(qc);
  return qc;
}
