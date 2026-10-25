import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { colors } from "./theme";

type Props = {
  children: ReactNode;
  edges?: Edge[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

/** Keeps focused inputs and primary actions visible above the software keyboard (Android edge-to-edge). */
export function KeyboardFormScreen({
  children,
  edges = ["top", "bottom"],
  contentContainerStyle,
  style,
}: Props) {
  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        {children}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
});
