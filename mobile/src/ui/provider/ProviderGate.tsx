import type { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import {
  providerCanUseNativeApp,
  providerStatusBodyKey,
  providerStatusTitleKey,
  providerStatusWebPath,
} from "@/lib/provider/gates";
import { useMyProvider } from "@/lib/provider/queries";
import { appConfig } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export function useProviderGate() {
  const q = useMyProvider();
  const provider = q.data as Record<string, unknown> | null | undefined;
  const status = provider?.onboarding_status as string | undefined;
  const allowed = providerCanUseNativeApp(!!provider, status);
  return { q, provider, status, allowed };
}

export function ProviderGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { q, provider, status, allowed } = useProviderGate();

  if (allowed) return <>{children}</>;

  const webPath = providerStatusWebPath(!!provider, status);
  const openWeb = () => WebBrowser.openBrowserAsync(`${appConfig.webOrigin}${webPath}`);

  return (
    <View style={styles.wrap}>
      <QueryState query={q}>
        <View style={styles.hero}>
          <Text size="title" weight="heavy">
            {t(providerStatusTitleKey(!!provider, status))}
          </Text>
          <Text tone="muted">
            {provider?.review_reason_public
              ? String(provider.review_reason_public)
              : t(providerStatusBodyKey(!!provider, status))}
          </Text>
          <Button label={t("mobilePro.continueOnWeb")} onPress={openWeb} />
          {!provider && (
            <Button
              variant="secondary"
              label={t("pro.gateway.backCustomer")}
              onPress={() => WebBrowser.openBrowserAsync(`${appConfig.webOrigin}/home`)}
            />
          )}
        </View>
      </QueryState>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background, padding: space.xxl },
  hero: { gap: space.lg, marginTop: space.xxl },
});
