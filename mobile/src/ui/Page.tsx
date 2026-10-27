import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import {
  KEYBOARD_FOCUS_GAP,
  KEYBOARD_PRIMARY_INLINE_OFFSET,
  KEYBOARD_PRIMARY_STICKY_RESERVE,
} from "./keyboardFormConstants";
import { Stack, router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Check, Inbox, CircleAlert } from "lucide-react-native";
import { Text } from "./Text";
import { Button } from "./Button";
import { bodyTextInputProps } from "./a11y";
import { colors, fonts, radius, space, shadow } from "./theme";

type Refreshable = { refetch: () => Promise<unknown> };
export function Page({
  title,
  children,
  queries = [],
  tab = false,
  footer,
  header,
  contentStyle,
  scrollHeader = false,
}: {
  title: string;
  children: ReactNode;
  queries?: Refreshable[];
  tab?: boolean;
  footer?: ReactNode;
  header?: ReactNode;
  contentStyle?: import("react-native").StyleProp<import("react-native").ViewStyle>;
  scrollHeader?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const { i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, space.md);
  return (
    <SafeAreaView
      style={[ui.page, { direction: i18n.language === "ar" ? "rtl" : "ltr" }]}
      edges={header ? ["top", "bottom"] : tab ? ["top"] : footer ? ["top"] : ["bottom"]}
    >
      {!tab && <Stack.Screen options={{ title, ...(header ? { headerShown: false } : {}) }} />}
      {!scrollHeader && header}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[ui.content, tab && { paddingBottom: 112 }, contentStyle]}
        bottomOffset={
          footer
            ? KEYBOARD_FOCUS_GAP + KEYBOARD_PRIMARY_STICKY_RESERVE
            : KEYBOARD_PRIMARY_INLINE_OFFSET
        }
        refreshControl={
          queries.length ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.brand}
              colors={[colors.brand]}
              onRefresh={async () => {
                setRefreshing(true);
                try {
                  await Promise.all(queries.map((q) => q.refetch()));
                } finally {
                  setRefreshing(false);
                }
              }}
            />
          ) : undefined
        }
      >
        {scrollHeader && header ? (
          <View style={{ marginHorizontal: -20, marginBottom: -16 }}>{header}</View>
        ) : null}
        {tab && !header && (
          <Text size="title" weight="heavy">
            {title}
          </Text>
        )}
        {children}
      </KeyboardAwareScrollView>
      {footer ? (
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={[ui.footer, { paddingBottom: safeBottom }]}>{footer}</View>
        </KeyboardStickyView>
      ) : null}
    </SafeAreaView>
  );
}
export function QueryState({
  query,
  empty,
  emptyKey = "mobile.empty",
  children,
}: {
  query: { isPending?: boolean; isLoading?: boolean; isError: boolean; refetch: () => unknown };
  empty?: boolean;
  emptyKey?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (query.isError)
    return (
      <View style={[ui.card, ui.state]} accessibilityLiveRegion="polite">
        <CircleAlert size={28} color={colors.destructive} accessible={false} />
        <Text tone="danger">{t("common.somethingWentWrong")}</Text>
        <Button
          label={t("common.retry")}
          variant="secondary"
          onPress={() => {
            query.refetch();
          }}
        />
      </View>
    );
  if (query.isLoading ?? query.isPending)
    return (
      <View style={[ui.card, ui.state]}>
        <ActivityIndicator color={colors.brand} />
        <Text tone="muted">{t("common.loading")}</Text>
      </View>
    );
  if (empty)
    return (
      <View style={[ui.card, ui.state]}>
        <View style={ui.stateIcon}>
          <Inbox size={28} color={colors.brand} accessible={false} />
        </View>
        <Text tone="muted" style={{ textAlign: "center" }}>
          {t(emptyKey)}
        </Text>
      </View>
    );
  return <>{children}</>;
}
export function ActionError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return error ? (
    <Text tone="danger" accessibilityLiveRegion="polite">
      {t("common.somethingWentWrong")}
    </Text>
  ) : null;
}
export function Row({
  label,
  detail,
  href,
  onPress,
}: {
  label: string;
  detail?: string;
  href?: Href;
  onPress?: () => void;
}) {
  const { i18n } = useTranslation();
  const Arrow = i18n.language === "ar" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress ?? (() => href && router.push(href))}
      style={({ pressed }) => [ui.row, pressed && ui.pressed]}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <Text weight="bold">{label}</Text>
        {detail ? (
          <Text tone="muted" size="sm">
            {detail}
          </Text>
        ) : null}
      </View>
      <Arrow size={20} color={colors.brand} />
    </Pressable>
  );
}
export function Field({
  label,
  ltr = false,
  style,
  ...props
}: TextInputProps & { label: string; ltr?: boolean }) {
  const { i18n } = useTranslation();
  return (
    <View style={{ gap: space.sm }}>
      <Text weight="bold">{label}</Text>
      <TextInput
        {...props}
        {...bodyTextInputProps()}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          ui.input,
          { fontFamily: (i18n.language === "ar" ? fonts.ar : fonts.en).regular },
          ltr && { writingDirection: "ltr" },
          style,
        ]}
      />
    </View>
  );
}
export function Choices({
  label,
  value,
  onChange,
  options,
  layout = "chips",
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
  layout?: "chips" | "cards" | "grid";
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text weight="bold">{label}</Text>
      <View style={layout === "cards" ? { gap: space.sm } : ui.wrap}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: value === o.value }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              ui.choice,
              layout !== "chips" && ui.optionCard,
              layout === "grid" && { flexBasis: "47%", flexGrow: 1 },
              value === o.value && { backgroundColor: colors.brandTint, borderColor: colors.brand },
              pressed && ui.pressed,
            ]}
          >
            {layout === "cards" && (
              <View
                accessible={false}
                style={[
                  ui.radio,
                  value === o.value && { backgroundColor: colors.brand, borderColor: colors.brand },
                ]}
              >
                {value === o.value && <Check size={14} color={colors.surface} />}
              </View>
            )}
            <Text
              style={{ flexShrink: 1 }}
              tone={value === o.value ? "brand" : "default"}
              weight="bold"
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function Confirm({
  title,
  body,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={ui.card} accessibilityLiveRegion="polite">
      <Text weight="heavy">{title}</Text>
      <Text>{body}</Text>
      <Button label={t("common.delete")} loading={busy} onPress={onConfirm} />
      <Button label={t("common.cancel")} variant="ghost" disabled={busy} onPress={onCancel} />
    </View>
  );
}
export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.xl, paddingBottom: space.xxxl, gap: space.xl, flexGrow: 1 },
  footer: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    gap: space.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  state: { alignItems: "center", justifyContent: "center", minHeight: 160, padding: space.xxl },
  stateIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  optionCard: {
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: space.md,
    padding: space.lg,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.lg,
    paddingVertical: space.xs,
  },
  priceTotal: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: space.lg,
    marginTop: space.xs,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTint,
  },
  heroCard: { backgroundColor: colors.brandTint, borderColor: colors.brandTintStrong },
  card: {
    padding: space.lg,
    borderRadius: radius.xl,
    ...shadow.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.md,
  },
  row: {
    minHeight: 64,
    padding: space.lg,
    borderRadius: radius.xl,
    ...shadow.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  choice: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  ltr: { writingDirection: "ltr" },
});
