import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, space } from "./theme";

function usePulse() {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export function SkeletonBlock({
  width,
  height,
  style,
  round,
}: {
  width?: number | `${number}%`;
  height: number;
  style?: ViewStyle;
  round?: number;
}) {
  const opacity = usePulse();
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        {
          width: width ?? "100%",
          height,
          borderRadius: round ?? radius.md,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View
      style={styles.listHost}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.listCard}>
          <View style={styles.listRow}>
            <SkeletonBlock width={52} height={52} round={radius.lg} />
            <View style={{ flex: 1, gap: space.sm }}>
              <SkeletonBlock height={16} width="72%" />
              <SkeletonBlock height={13} width="48%" />
            </View>
          </View>
          <SkeletonBlock height={13} width="88%" />
        </View>
      ))}
    </View>
  );
}

export function DetailSkeleton() {
  return (
    <View
      style={styles.detailHost}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
    >
      <View style={{ alignItems: "center", gap: space.md }}>
        <SkeletonBlock width={96} height={96} round={48} />
        <SkeletonBlock height={22} width="55%" />
        <SkeletonBlock height={14} width="40%" />
      </View>
      <View style={styles.detailCard}>
        <SkeletonBlock height={16} width="35%" />
        <SkeletonBlock height={14} width="100%" />
        <SkeletonBlock height={14} width="92%" />
      </View>
      <View style={styles.detailCard}>
        <SkeletonBlock height={16} width="42%" />
        <SkeletonBlock height={48} width="100%" round={radius.lg} />
      </View>
    </View>
  );
}

export function ConversationListSkeleton() {
  return <ListSkeleton count={5} />;
}

export function ChatThreadSkeleton() {
  return (
    <View
      style={styles.chatHost}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.chatBubbleOther}>
        <SkeletonBlock height={40} width="68%" round={radius.lg} />
      </View>
      <View style={styles.chatBubbleMe}>
        <SkeletonBlock height={32} width="52%" round={radius.lg} />
      </View>
      <View style={styles.chatBubbleOther}>
        <SkeletonBlock height={56} width="74%" round={radius.lg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface2 },
  listHost: { gap: space.md, width: "100%" },
  listCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  detailHost: { gap: space.lg, width: "100%" },
  detailCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatHost: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.md, gap: space.lg },
  chatBubbleOther: { alignItems: "flex-start" },
  chatBubbleMe: { alignItems: "flex-end" },
});
