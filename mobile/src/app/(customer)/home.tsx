import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ArrowUpLeft, ArrowUpRight, Baby, Bell, ChevronDown, GraduationCap, MapPin, Search } from "lucide-react-native";
import { useCategories, useDefaultAddress, useMyProfile, useUnreadNotificationCount } from "@/lib/queries";
import { Text } from "@/ui/Text";
import { colors, radius, shadow, space } from "@/ui/theme";

const SERVICE_TILES = {
  babysitting: { icon: Baby, surface: colors.brandTint, ink: colors.brand, taglineKey: "home.babysittingTag" },
  tutoring: { icon: GraduationCap, surface: colors.lavenderTint, ink: colors.lavender, taglineKey: "home.tutoringTag" },
} as const;

export default function Home() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language !== "en";
  const profile = useMyProfile();
  const address = useDefaultAddress();
  const categories = useCategories();
  const unread = useUnreadNotificationCount();
  const firstName = profile.data?.full_name?.split(" ")[0] || t("greetings.there");
  const Arrow = isAr ? ArrowUpLeft : ArrowUpRight;

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: space.xxxl }}>
      <LinearGradient colors={[colors.brandTintStrong, colors.brandTint, colors.background]} style={styles.header}>
        <SafeAreaView edges={["top"]}>
          <View style={styles.topRow}>
            <Pressable style={[styles.chip, shadow.card]} accessibilityRole="button">
              <MapPin size={16} color={colors.brand} strokeWidth={2.4} />
              <Text size="sm" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                {address.data?.area || t("customerHome.chooseArea")}
              </Text>
              <ChevronDown size={16} color={colors.muted} />
            </Pressable>
            <Pressable style={[styles.bell, shadow.card]} accessibilityLabel={t("common.notifications")}>
              <Bell size={20} color={colors.foreground} />
              {(unread.data ?? 0) > 0 ? <View style={styles.dot} /> : null}
            </Pressable>
          </View>

          <Text weight="bold" tone="muted" style={{ marginTop: space.xxl }}>
            {t("greetings.withName", { greeting: t("greetings.hello"), name: firstName })}
          </Text>
          <Text size="title" weight="heavy">
            {t("home.headline")}
          </Text>

          <Pressable style={[styles.search, shadow.card]} accessibilityRole="search">
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
        <View style={styles.tiles}>
          {(categories.data ?? []).map((c) => {
            const tile = SERVICE_TILES[c.slug as keyof typeof SERVICE_TILES];
            if (!tile) return null;
            const Icon = tile.icon;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                style={({ pressed }) => [styles.tile, { backgroundColor: tile.surface }, pressed && { opacity: 0.9 }]}
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
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingTop: space.lg },
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
  tile: { flex: 1, minHeight: 160, borderRadius: radius.xl, padding: space.lg, justifyContent: "space-between" },
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
