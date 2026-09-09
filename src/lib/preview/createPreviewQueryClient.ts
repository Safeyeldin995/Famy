import { QueryClient } from "@tanstack/react-query";
import { seedPreviewQueries } from "@/lib/preview/mockData";

type PreviewWindow = Window & {
  __famyPreviewFetchGuard?: boolean;
  __famyPreviewRealFetch?: typeof fetch;
};

function previewWindow(): PreviewWindow | null {
  if (typeof window === "undefined") return null;
  return window as PreviewWindow;
}

function isPreviewPath(pathname: string) {
  return pathname === "/preview" || pathname.startsWith("/preview/");
}

export function installPreviewFetchGuard() {
  const w = previewWindow();
  if (!w || w.__famyPreviewFetchGuard) return;

  const realFetch = w.fetch.bind(w);
  w.__famyPreviewRealFetch = realFetch;
  w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const onPreview = isPreviewPath(w.location.pathname);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (onPreview && url.includes("supabase.co")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  w.__famyPreviewFetchGuard = true;
}

export function uninstallPreviewFetchGuard() {
  const w = previewWindow();
  if (!w) return;
  if (w.__famyPreviewRealFetch) {
    w.fetch = w.__famyPreviewRealFetch;
    delete w.__famyPreviewRealFetch;
  }
  w.__famyPreviewFetchGuard = false;
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
