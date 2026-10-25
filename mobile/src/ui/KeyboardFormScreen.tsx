import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import {
  keyboardInlineBottomOffset,
  keyboardStickyBottomOffset,
  keyboardStickyScrollPaddingBottom,
} from "./keyboardFormLayout";
import { colors, space } from "./theme";

type Props = {
  children: ReactNode;
  footer?: ReactNode;
  edges?: Edge[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

/** Keeps focused inputs and primary actions visible above the software keyboard (Android edge-to-edge). */
export function KeyboardFormScreen({
  children,
  footer,
  edges = ["top", "bottom"],
  contentContainerStyle,
  style,
}: Props) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, space.md);
  const [footerHeight, setFooterHeight] = useState(0);

  const stickyScrollPadding = footer ? keyboardStickyScrollPaddingBottom(footerHeight) : 0;

  return (
    <SafeAreaView style={[styles.safe, style]} edges={footer ? ["top"] : edges}>
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          contentContainerStyle,
          footer ? { paddingBottom: stickyScrollPadding } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={
          footer ? keyboardStickyBottomOffset(footerHeight) : keyboardInlineBottomOffset()
        }
      >
        {children}
      </KeyboardAwareScrollView>
      {footer ? (
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View
            style={[styles.footer, { paddingBottom: safeBottom }]}
            onLayout={(e) => {
              const next = Math.ceil(e.nativeEvent.layout.height);
              setFooterHeight((prev) => (prev === next ? prev : next));
            }}
          >
            {footer}
          </View>
        </KeyboardStickyView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  footer: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    gap: space.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
