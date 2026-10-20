import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useSession } from "./session";

/** Services open in the closed beta (same list as the web home). */
export const BETA_CATEGORY_SLUGS = ["babysitting", "tutoring"] as const;

export function useMyProfile() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    enabled: !!userId,
    queryKey: ["my-profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useDefaultAddress() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    enabled: !!userId,
    queryKey: ["default-address", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("addresses")
        .select("*")
        .eq("user_id", userId!)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, slug, name_ar, name_en, icon, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []).filter((row) =>
        (BETA_CATEGORY_SLUGS as readonly string[]).includes(row.slug),
      );
    },
  });
}

export function useUnreadNotificationCount() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    enabled: !!userId,
    queryKey: ["unread-notifications", userId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId!)
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
