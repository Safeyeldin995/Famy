import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { router } from "expo-router";
import { QueryState, Row } from "@/ui/Page";
import { ProviderCard } from "@/ui/ProviderCard";
import { HomePromoStrip } from "@/ui/HomePromoStrip";
import { recentProviders, uniqueProviders } from "@/lib/presentation";
import { Pressable, ScrollView, RefreshControl, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import {
  ArrowUpLeft,
  ArrowUpRight,
  Baby,
  Bell,
  ChevronDown,
  GraduationCap,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react-native";
import {
  useCategories,
  useDefaultAddress,
  useMyProfile,
  useUnreadNotificationCount,
  useProviders,
  useMyBookings,
  useFeaturedPromoCodes,
} from "@/lib/queries";
import { Text } from "@/ui/Text";
import { colors, radius, shadow, space } from "@/ui/theme";

const SERVICE_TILES = {
  babysitting: {
    icon: Baby,
    surface: colors.brandTint,
    ink: colors.brand,
    taglineKey: "home.babysittingTag",
  },
  tutoring: {
    icon: GraduationCap,
    surface: colors.lavenderTint,
    ink: colors.lavender,
    taglineKey: "home.tutoringTag",
  },
} as const;

export default function Home() {
  const { t, i18n } = useTranslation();
  const cache = useQueryClient();
  const isAr = i18n.language !== "en";
  const profile = useMyProfile();
  const address = useDefaultAddress();
  const categories = useCategories();
  const unread = useUnreadNotificationCount();
  const bookings = useMyBookings();
  const promos = useFeaturedPromoCodes();
  const [refreshing, setRefreshing] = useState(false);
  const firstName = profile.data?.full_name?.split(" ")[0] || t("greetings.there");
  const Arrow = isAr ? ArrowUpLeft : ArrowUpRight;

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.brand}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              await Promise.all(
                [profile, address, categories, unread, bookings, promos].map((q) => q.refetch()),
              );
            } finally {
              await cache.refetchQueries({ queryKey: ["providers"], type: "active" });
              setRefreshing(false);
            }
          }}
        />
      }
      style={[styles.page, { direction: isAr ? "rtl" : "ltr" }]}
      contentContainerStyle={{ paddingBottom: space.xxxl }}
    >
      <LinearGradient
        colors={[colors.brandTintStrong, colors.brandTint, colors.background]}
        style={styles.header}
      >
        <SafeAreaView edges={["top"]}>
          <View style={styles.topRow}>
            <Pressable
              onPress={() => router.push("/addresses")}
              style={({ pressed }) => [styles.chip, shadow.card, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={address.data?.area || t("customerHome.chooseArea")}
            >
              <MapPin size={16} color={colors.brand} strokeWidth={2.4} />
              <Text size="sm" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                {address.data?.area || t("customerHome.chooseArea")}
              </Text>
              <ChevronDown size={16} color={colors.muted} />
            </Pressable>
            <Pressable
              onPress={() => router.push("/notifications")}
              style={({ pressed }) => [styles.bell, shadow.card, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={t("common.notifications")}
            >
              <Bell size={20} color={colors.foreground} />
              {(unread.data ?? 0) > 0 ? <View testID="home-unread" style={styles.dot} /> : null}
            </Pressable>
          </View>

          <Text weight="bold" tone="muted" style={{ marginTop: space.xxl }}>
            {t("greetings.withName", { greeting: t("greetings.hello"), name: firstName })}
          </Text>
          <Text size="title" weight="heavy">
            {t("home.headline")}
          </Text>

          <Pressable
            onPress={() => router.push("/search")}
            style={({ pressed }) => [styles.search, shadow.card, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={t("customerSearch.placeholder")}
          >
            <Search size={20} color={colors.brand} strokeWidth={2.4} />
            <Text tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {t("customerSearch.placeholder")}
            </Text>
          </Pressable>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.section}>
        <Text size="xl" weight="heavy">
          {t("home.chooseService")}
        </Text>
        <QueryState query={categories} empty={!categories.data?.length}>
          <View style={styles.tiles}>
            {(categories.data ?? []).map((c) => {
              const tile = SERVICE_TILES[c.slug as keyof typeof SERVICE_TILES];
              if (!tile) return null;
              const Icon = tile.icon;
              return (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    router.push({ pathname: "/category/[id]", params: { id: c.slug } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={isAr ? c.name_ar : c.name_en}
                  style={({ pressed }) => [
                    styles.tile,
                    { backgroundColor: tile.surface },
                    pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <View style={styles.tileTop}>
                    <View style={styles.tileIcon}>
                      <Icon size={24} color={tile.ink} strokeWidth={2.4} />
                    </View>
                    <Arrow size={20} color={tile.ink} />
                  </View>
                  <View style={{ gap: 4 }}>
                    <Text size="lg" weight="heavy">
                      {isAr ? c.name_ar : c.name_en}
                    </Text>
                    <Text size="xs" weight="bold" tone="muted">
                      {t(tile.taglineKey)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </QueryState>
      </View>
      {promos.isError ? (
        <QueryState query={promos} />
      ) : promos.data?.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          style={{ marginTop: 32 }}
        >
          {promos.data.map((p) => (
            <HomePromoStrip key={p.id} offer={p} />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.section}>
        <QueryState query={address}>
          {address.data ? (
            <NearbyProviders addressId={address.data.id} />
          ) : (
            <Row
              label={t("customerHome.chooseArea")}
              detail={t("customerHome.addressHint")}
              href="/addresses"
            />
          )}
        </QueryState>
        <Text size="xl" weight="heavy">
          {t("mobile.bookAgain")}
        </Text>
        <QueryState query={bookings} empty={!recentProviders(bookings.data ?? []).length}>
          {recentProviders(bookings.data ?? []).map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </QueryState>
        {["home.trust1", "home.trust2", "home.trust3"].map((k) => (
          <View
            key={k}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingVertical: space.sm,
            }}
          >
            <ShieldCheck size={20} color={colors.brand} accessible={false} />
            <Text tone="muted" size="sm" style={{ flex: 1 }}>
              {t(k)}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    borderBottomStartRadius: 32,
    borderBottomEndRadius: 32,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingTop: space.lg,
  },
  chip: {
    flexShrink: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 10,
    end: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  search: {
    marginTop: space.xl,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  section: { paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.md },
  tiles: { flexDirection: "row", gap: space.md },
  tile: {
    flex: 1,
    minHeight: 160,
    borderRadius: radius.xl,
    padding: space.lg,
    justifyContent: "space-between",
  },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});

function NearbyProviders({ addressId }: { addressId: string }) {
  const { t } = useTranslation();
  const a = useProviders({ addressId, categorySlug: "babysitting", limit: 20 });
  const b = useProviders({ addressId, categorySlug: "tutoring", limit: 20 });
  const providers = uniqueProviders([...(a.data ?? []), ...(b.data ?? [])]);
  return (
    <View style={{ gap: space.md }}>
      <Row label={t("customerHome.nearby")} href="/search" />
      <QueryState
        query={{
          isLoading: a.isLoading || b.isLoading,
          isError: a.isError || b.isError,
          refetch: () => Promise.all([a.refetch(), b.refetch()]),
        }}
        empty={!providers.length}
        emptyKey="customerHome.empty"
      >
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </QueryState>
    </View>
  );
}
