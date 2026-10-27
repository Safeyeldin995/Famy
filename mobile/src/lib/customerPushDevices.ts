import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useSession } from "./session";

export type CustomerPushDevice = {
  id: string;
  device_label: string | null;
  kind: "web" | "native";
  last_seen_at: string;
};

/** Only display metadata. Never put push tokens/endpoints in the UI or query cache. */
export function useCustomerPushDevices() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["customer-push-devices", userId],
    enabled: !!userId,
    queryFn: async (): Promise<CustomerPushDevice[]> => {
      if (!userId) throw new Error("not_authenticated");
      const [web, native] = await Promise.all([
        supabase
          .from("push_subscriptions")
          .select("id, device_label, last_seen_at")
          .eq("user_id", userId)
          .is("revoked_at", null),
        supabase
          .from("device_push_tokens")
          .select("id, platform, last_seen_at")
          .eq("user_id", userId)
          .is("revoked_at", null),
      ]);
      if (web.error) throw web.error;
      if (native.error) throw native.error;
      return [
        ...(web.data ?? []).map((d) => ({ ...d, kind: "web" as const })),
        ...(native.data ?? []).map((d) => ({
          id: d.id,
          device_label: d.platform === "ios" ? "iPhone" : "Android",
          last_seen_at: d.last_seen_at,
          kind: "native" as const,
        })),
      ].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
    },
  });
}

export function useRevokeCustomerPushDevice() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (device: CustomerPushDevice) => {
      const userId = session?.user.id;
      if (!userId) throw new Error("not_authenticated");
      if (device.kind === "web") {
        const { error } = await supabase.rpc("revoke_push_subscription_by_id", { p_id: device.id });
        if (error) throw error;
      } else {
        // The existing native RPC accepts a token, not an ID. Resolve it under
        // both RLS and explicit ownership; do not display, log or cache it.
        const { data, error } = await supabase
          .from("device_push_tokens")
          .select("token")
          .eq("id", device.id)
          .eq("user_id", userId)
          .is("revoked_at", null)
          .single();
        if (error) throw error;
        const result = await supabase.rpc("revoke_device_push_token", { p_token: data.token });
        if (result.error) throw result.error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-push-devices"] }),
  });
}
