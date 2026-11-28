import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { QueryState, Row } from "@/ui/Page";
import { ProviderCard } from "@/ui/ProviderCard";
import { HomePromoStrip } from "@/ui/HomePromoStrip";
import { recentProviders } from "@/lib/presentation";
import { takeGuestIntent } from "@/lib/guest";
import {
  Platform,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { tabScrollContentPadding } from "@/ui/a11y";
import { useTranslation } from "react-i18next";
import {
  ArrowUpLeft,
  ArrowUpRight,
  Baby,
  Bell,
  ChevronDown,
  GraduationCap,
  MapPin,
  ShieldCheck,
} from "lucide-react-native";
import {
  useCategories,
  useDefaultAddress,
  useMyProfile,
  useUnreadNotificationCount,
  useMyBookings,
  useFeaturedPromoCodes,
  useMarketplaceServices,
} from "@/lib/queries";
import { Text } from "@/ui/Text";
import { LessonIllustration } from "@/ui/lessons/LessonIllustration";
import {
  homeCategoryLessonSlug,
  visibleHomeDoors,
  visibleTutoringShortcuts,
  type HomeDoorId,
} from "@shared/catalog/homeCategories";
import { colors, radius, shadow, space } from "@/ui/theme";
import { HomeActiveBookingCard } from "@/ui/customer/HomeActiveBookingCard";
import { RatingPromptCard } from "@/ui/customer/RatingPromptCard";
import { FeeDebtBanner } from "@/ui/FeeDebtBanner";
import { useBookingParties } from "@/lib/queries";
import { customerHomeActiveBookings } from "@shared/home/activeHomeBookings";
import { useSession } from "@/lib/session";
import { maybePromptForStoreReview } from "@/lib/storeReviewPrompt";
import { latestCompletedBookingWithoutReview } from "@/lib/customerBookingsList";
import { dismissRatePrompt, loadDismissedRatePrompts } from "@/lib/ratePromptDismissals";
import {
  bumpHomeFocusEffect,
  bumpHomeQueryFetch,
  homeFreezeDiagEnabled,
  homeFreezeLegacyMode,
  resetHomeFreezeDiagnostics,
} from "@/lib/homeFreezeDiagnostics";

const DOORS: Record<
  HomeDoorId,
  { icon: typeof Baby; surface: string; ink: string; titleKey: string; bodyKey: string }
> = {
  tutoring: {
    icon: GraduationCap,
    surface: colors.lavenderTint,
    ink: colors.lavender,
    titleKey: "home.doors.tutorTitle",
    bodyKey: "home.doors.tutorBody",
  },
  babysitting: {
    icon: Baby,
    surface: colors.brandTint,
    ink: colors.brand,
    titleKey: "home.doors.babysitterTitle",
    bodyKey: "home.doors.babysitterBody",
  },
};

export default function Home() {
  const { session } = useSession();
  const { t, i18n } = useTranslation();
  const cache = useQueryClient();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const tabScrollPad = tabScrollContentPadding(fontScale, insets.bottom);
  const isAr = i18n.language !== "en";
  const profile = useMyProfile();
  const address = useDefaultAddress();
  const categories = useCategories();
  const tutoringServices = useMarketplaceServices("tutoring");
  const unread = useUnreadNotificationCount();
  const bookings = useMyBookings();
  const [dismissedRatePrompts, setDismissedRatePrompts] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDismissedRatePrompts().then((ids) => {
      if (alive) setDismissedRatePrompts(ids);
    });
    return () => {
      alive = false;
    };
  }, []);
  const rateTarget = useMemo(
    () =>
      dismissedRatePrompts
        ? latestCompletedBookingWithoutReview(bookings.data ?? [], {
            dismissedIds: dismissedRatePrompts,
          })
        : null,
    [bookings.data, dismissedRatePrompts],
  );
  const dismissRateTarget = (bookingId: string) => {
    setDismissedRatePrompts((prev) => new Set([...(prev ?? []), bookingId]));
    void dismissRatePrompt(bookingId);
  };
  const activeIds = useMemo(
    () => customerHomeActiveBookings(bookings.data ?? []).map((b) => b.id),
    [bookings.data],
  );
  const partyBookingIds = useMemo(() => {
    const ids = [...activeIds];
    if (rateTarget) ids.push(rateTarget.id);
    return ids;
  }, [activeIds, rateTarget]);
  const parties = useBookingParties(partyBookingIds);
  const promos = useFeaturedPromoCodes();
  const legacyFreeze = homeFreezeLegacyMode();
  const [refreshing, setRefreshing] = useState(false);
  const fetchWasActive = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (homeFreezeDiagEnabled()) resetHomeFreezeDiagnostics();
  }, []);

  useEffect(() => {
    if (!homeFreezeDiagEnabled()) return;
    const tracked: [string, boolean][] = [
      ["profile", profile.isFetching],
      ["address", address.isFetching],
      ["categories", categories.isFetching],
      ["tutoringServices", tutoringServices.isFetching],
      ["unread", unread.isFetching],
      ["bookings", bookings.isFetching],
      ["parties", parties.isFetching],
      ["promos", promos.isFetching],
    ];
    for (const [key, active] of tracked) {
      if (active && !fetchWasActive.current[key]) bumpHomeQueryFetch(key);
      fetchWasActive.current[key] = active;
    }
  }, [
    profile.isFetching,
    address.isFetching,
    categories.isFetching,
    tutoringServices.isFetching,
    unread.isFetching,
    bookings.isFetching,
    parties.isFetching,
    promos.isFetching,
  ]);

  // A visitor who tapped "book" while browsing as a guest resumes at that provider.
  useEffect(() => {
    let cancelled = false;
    void takeGuestIntent().then((intent) => {
      if (cancelled || !intent) return;
      router.push({
        pathname: "/provider/[id]",
        params: intent.serviceId
          ? { id: intent.providerId, serviceId: intent.serviceId }
          : { id: intent.providerId },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void maybePromptForStoreReview(session?.user?.id);
      bumpHomeFocusEffect();
      if (legacyFreeze) {
        bumpHomeQueryFetch("bookingsFocusRefetch");
        void bookings.refetch();
      } else {
        bumpHomeQueryFetch("bookingsFocusInvalidate");
      }
      void cache.invalidateQueries({ queryKey: ["my-bookings"] });
      void cache.invalidateQueries({ queryKey: ["customer-fee-debts"] });
    }, [cache, legacyFreeze, bookings.refetch, session?.user?.id]),
  );
  const firstName = profile.data?.full_name?.split(" ")[0] || t("greetings.there");
  const Arrow = isAr ? ArrowUpLeft : ArrowUpRight;
  const recent = recentProviders(bookings.data ?? []);
  const returning = activeIds.length > 0 || recent.length > 0;
  const doors = visibleHomeDoors((categories.data ?? []).map((c) => c.slug));
  const shortcuts = visibleTutoringShortcuts((tutoringServices.data ?? []).map((svc) => svc.slug));

  const bookAgainSection =
    returning && recent.length ? (
      <View style={styles.sectionCompact}>
        <Text size="lg" weight="heavy">
          {t("mobile.bookAgain")}
        </Text>
        <QueryState query={bookings} empty={!recent.length}>
          {recent.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </QueryState>
      </View>
    ) : null;

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.brand}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              const core = [
                profile,
                address,
                categories,
                tutoringServices,
                unread,
                bookings,
                promos,
              ].map((q) => q.refetch());
              if (legacyFreeze || activeIds.length) core.push(parties.refetch());
              await Promise.all(core);
              if (legacyFreeze) {
                await cache.refetchQueries({ queryKey: ["providers"], type: "active" });
              }
            } finally {
              setRefreshing(false);
              if (!legacyFreeze) {
                void cache.refetchQueries({ queryKey: ["providers"], type: "active" });
              }
            }
          }}
        />
      }
      style={[styles.page, { direction: isAr ? "rtl" : "ltr" }]}
      contentContainerStyle={{ paddingBottom: tabScrollPad }}
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

          <Text
            weight="bold"
            tone="muted"
            size="sm"
            style={{ marginTop: returning ? space.lg : space.md }}
          >
            {t("greetings.withName", { greeting: t("greetings.hello"), name: firstName })}
          </Text>
          <Text size={returning ? "xl" : "xxl"} weight="heavy">
            {t("home.headline")}
          </Text>
        </SafeAreaView>
      </LinearGradient>

      <FeeDebtBanner />
      {!bookings.isError && bookings.data ? (
        <HomeActiveBookingCard bookings={bookings.data} parties={parties.data} />
      ) : null}
      {rateTarget ? (
        <RatingPromptCard
          testID="home-rate-prompt"
          bookingId={rateTarget.id}
          onDismiss={() => dismissRateTarget(rateTarget.id)}
          providerName={
            parties.data?.get(rateTarget.id)?.other_name ||
            rateTarget.provider?.profile.full_name ||
            t("provider2.unnamed")
          }
        />
      ) : null}

      {bookAgainSection}

      <View style={[styles.sectionCompact, !returning && styles.sectionAboveFold]}>
        <QueryState query={categories} empty={!doors.length} emptyKey="home.doors.empty">
          <View style={styles.doors}>
            {doors.map((id) => {
              const door = DOORS[id];
              const Icon = door.icon;
              return (
                <View
                  key={id}
                  testID={`home-door-${id}`}
                  style={[styles.door, { backgroundColor: door.surface }]}
                >
                  <Pressable
                    onPress={() => router.push({ pathname: "/category/[id]", params: { id } })}
                    accessibilityRole="button"
                    accessibilityLabel={t(door.titleKey)}
                    accessibilityHint={t(door.bodyKey)}
                    style={({ pressed }) => [
                      styles.doorMain,
                      pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    <View style={styles.tileIcon}>
                      <Icon size={26} color={door.ink} strokeWidth={2.4} />
                    </View>
                    <View style={{ flex: 1, gap: space.xs }}>
                      <Text size="xl" weight="heavy">
                        {t(door.titleKey)}
                      </Text>
                      <Text size="sm" weight="bold" tone="muted">
                        {t(door.bodyKey)}
                      </Text>
                    </View>
                    <Arrow size={22} color={door.ink} />
                  </Pressable>
                  {id === "tutoring" && shortcuts.length ? (
                    <View style={styles.shortcuts}>
                      {shortcuts.map((group) => {
                        const lesson = homeCategoryLessonSlug(group);
                        const label = t(`home.doors.${group}`);
                        return (
                          <Pressable
                            key={group}
                            testID={`home-door-shortcut-${group}`}
                            onPress={() =>
                              router.push({ pathname: "/category/[id]", params: { id: group } })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={label}
                            style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.8 }]}
                          >
                            {lesson ? (
                              <LessonIllustration serviceSlug={lesson} width={28} height={28} />
                            ) : null}
                            <Text size="sm" weight="bold">
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
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
          nestedScrollEnabled={Platform.OS === "android"}
          testID="home-promos"
          snapToInterval={284}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md }}
          style={{ marginTop: space.xxxl }}
        >
          {promos.data.map((p) => (
            <HomePromoStrip key={p.id} offer={p} />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.sectionCompact}>
        {address.isSuccess && !address.data ? (
          <Row
            label={t("customerHome.chooseArea")}
            detail={t("customerHome.addressHint")}
            href="/addresses"
          />
        ) : null}
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
    paddingBottom: space.lg,
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
    gap: space.xs + 2,
    paddingHorizontal: space.md + 2,
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
  section: { paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.md },
  sectionCompact: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.md },
  sectionAboveFold: { paddingTop: space.md },
  doors: { gap: space.md },
  door: { borderRadius: radius.xl, padding: space.lg, gap: space.md },
  doorMain: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72 },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  shortcut: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
