import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { onlineLessonSessionHref } from "@/lib/resolveOnlineLessonLink";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/ui/theme";

export default function LessonLinkResolver() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, ready } = useSession();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!id) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("customer_id, providers ( profile_id )")
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        router.replace("/");
        return;
      }

      const providerRow = data.providers as { profile_id: string } | { profile_id: string }[] | null;
      const providerProfileId = Array.isArray(providerRow)
        ? (providerRow[0]?.profile_id ?? null)
        : (providerRow?.profile_id ?? null);

      setHref(
        onlineLessonSessionHref(id, session.user.id, {
          customerId: data.customer_id,
          providerProfileId,
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [id, ready, session]);

  if (href) {
    return <Redirect href={href} />;
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}