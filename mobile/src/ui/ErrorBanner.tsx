import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

/** Shared destructive / validation error surface (login, OTP, wallet blocks). */
export function ErrorBanner({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.banner, style]}>
      {typeof children === "string" ? (
        <Text size="sm" weight="bold" tone="danger">
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.destructiveTint,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
});