import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/lib/catalog/qaCatalog", () => ({
  isQaCatalogService: () => false,
}));

import { useReplaceAvailability } from "@/lib/db/provider-queries";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useReplaceAvailability", () => {
  it("calls the atomic RPC and throws on error", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Access denied.", code: "42501" },
    });

    const { result } = renderHook(() => useReplaceAvailability(), { wrapper });
    const rules = [{ weekday: 1, start_time: "09:00", end_time: "17:00" }];

    await expect(result.current.mutateAsync({ providerId: "prov-1", rules })).rejects.toMatchObject(
      { code: "42501" },
    );

    expect(rpc).toHaveBeenCalledWith("replace_provider_availability", {
      p_provider_id: "prov-1",
      p_rules: rules,
    });
  });
});
