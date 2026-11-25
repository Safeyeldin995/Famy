import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useProviderGate } from "./useProviderGate";
import { providerStatusNativePath } from "@/lib/provider/gates";
import { QueryState } from "@/ui/Page";
import { colors, space } from "@/ui/theme";

/** Redirect non-approved providers away from the main tab experience. */
export function ProviderGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { q, provider, status, allowed } = useProviderGate();
  if (q.isError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: space.xl }}>
        <QueryState query={q}>{null}</QueryState>
      </View>
    );
  }
  if (q.isLoading || q.isPending) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.brand} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (!q.isSuccess) return null;
  if (!allowed) {
    return <Redirect href={providerStatusNativePath(!!provider, status)} />;
  }
  return <>{children}</>;
}
