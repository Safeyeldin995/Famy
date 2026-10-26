import type { ReactNode } from "react";
import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Text } from "./Text";
import { colors } from "./theme";

/** Matches the web EmptyState rather than the native generic query placeholder. */
export function CustomerEmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View style={{ paddingVertical: 48, alignItems: "center" }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 28,
          backgroundColor: colors.brandTint,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={36} color={colors.brand} />
      </View>
      <Text size="xl" weight="heavy" style={{ marginTop: 16, textAlign: "center" }}>
        {title}
      </Text>
      {body ? (
        <Text tone="muted" style={{ marginTop: 6, maxWidth: 320, textAlign: "center" }}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 20 }}>{action}</View> : null}
    </View>
  );
}
