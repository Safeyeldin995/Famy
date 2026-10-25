import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import {
  KEYBOARD_FOCUS_GAP,
  KEYBOARD_PRIMARY_INLINE_OFFSET,
  KEYBOARD_PRIMARY_STICKY_RESERVE,
} from "./keyboardFormConstants";
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

  return (
    <SafeAreaView style={[styles.safe, style]} edges={footer ? ["top"] : edges}>
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={
          footer
            ? KEYBOARD_FOCUS_GAP + KEYBOARD_PRIMARY_STICKY_RESERVE
            : KEYBOARD_PRIMARY_INLINE_OFFSET
        }
      >
        {children}
      </KeyboardAwareScrollView>
      {footer ? (
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={[styles.footer, { paddingBottom: safeBottom }]}>{footer}</View>
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
