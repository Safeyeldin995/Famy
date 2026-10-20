import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Text } from "./Text";
import { colors, space } from "./theme";

/** Placeholder for tabs whose native screens are still being built. */
export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Text size="xxl" weight="heavy">
        {t(titleKey)}
      </Text>
      <View style={styles.body}>
        <Text tone="muted" style={{ textAlign: "center" }}>
          {t("mobile.comingSoon")}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, padding: space.xl },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
});
