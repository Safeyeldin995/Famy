import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors, fonts, radius, space } from "./theme";

type Refreshable = { refetch: () => Promise<unknown> };
export function Page({
  title,
  children,
  queries = [],
  tab = false,
}: {
  title: string;
  children: ReactNode;
  queries?: Refreshable[];
  tab?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <SafeAreaView style={ui.page} edges={tab ? ["top"] : ["bottom"]}>
      {!tab && <Stack.Screen options={{ title }} />}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={ui.content}
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
        {tab && (
          <Text size="title" weight="heavy">
            {title}
          </Text>
        )}
        {children}
      </ScrollView>
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
      <View style={ui.card} accessibilityLiveRegion="polite">
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
      <View style={ui.card}>
        <ActivityIndicator color={colors.brand} />
        <Text tone="muted">{t("common.loading")}</Text>
      </View>
    );
  if (empty)
    return (
      <View style={ui.card}>
        <Text tone="muted">{t(emptyKey)}</Text>
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
      onPress={onPress ?? (() => href && router.push(href))}
      style={ui.row}
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
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text weight="bold">{label}</Text>
      <View style={ui.wrap}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === o.value }}
            onPress={() => onChange(o.value)}
            style={[
              ui.choice,
              value === o.value && { backgroundColor: colors.brandTint, borderColor: colors.brand },
            ]}
          >
            <Text tone={value === o.value ? "brand" : "default"} weight="bold">
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
  content: { padding: space.xl, paddingBottom: space.xxxl, gap: space.lg, flexGrow: 1 },
  card: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.md,
  },
  row: {
    minHeight: 64,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  input: {
    minHeight: 48,
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
