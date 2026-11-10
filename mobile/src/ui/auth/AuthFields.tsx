import type { ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react-native";
import { bodyTextInputProps } from "../a11y";
import { Text } from "../Text";
import { colors, fontSize, radius, space } from "../theme";
import { useInputFont } from "./useInputFont";

export function AuthLabeledField({
  label,
  labelAccessory,
  children,
}: {
  label: string;
  labelAccessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      {labelAccessory ? (
        <View style={styles.labelRow}>
          <Text size="sm" weight="bold" tone="muted">
            {label}
          </Text>
          {labelAccessory}
        </View>
      ) : (
        <Text size="sm" weight="bold" tone="muted">
          {label}
        </Text>
      )}
      {children}
    </View>
  );
}

export function AuthPhoneField({
  value,
  onChangeText,
  placeholder,
  ...rest
}: Omit<TextInputProps, "value" | "onChangeText"> & {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  const inputFont = useInputFont("bold");
  return (
    <View style={[styles.field, styles.ltr]}>
      <View style={styles.prefix}>
        <Text weight="heavy">🇪🇬 +20</Text>
      </View>
      <TextInput
        {...bodyTextInputProps()}
        {...rest}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/[^\d٠-٩۰-۹ ]/g, ""))}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        style={[styles.input, { fontFamily: inputFont, writingDirection: "ltr" }]}
      />
    </View>
  );
}

export function AuthPasswordField({
  value,
  onChangeText,
  showPassword,
  onToggleShow,
  showPasswordLabel,
  hidePasswordLabel,
  ...rest
}: Omit<TextInputProps, "value" | "onChangeText"> & {
  value: string;
  onChangeText: (value: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  showPasswordLabel: string;
  hidePasswordLabel: string;
}) {
  const inputFont = useInputFont("bold");
  return (
    <View style={styles.field}>
      <TextInput
        {...bodyTextInputProps()}
        {...rest}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!showPassword}
        placeholderTextColor={colors.muted}
        style={[styles.input, { fontFamily: inputFont }]}
      />
      <Pressable
        onPress={onToggleShow}
        accessibilityRole="button"
        accessibilityLabel={showPassword ? hidePasswordLabel : showPasswordLabel}
        style={styles.eye}
      >
        {showPassword ? (
          <EyeOff size={20} color={colors.muted} />
        ) : (
          <Eye size={20} color={colors.muted} />
        )}
      </Pressable>
    </View>
  );
}

export function AuthTextField({
  style,
  weight = "bold",
  ...rest
}: TextInputProps & { weight?: "regular" | "bold" }) {
  const inputFont = useInputFont(weight);
  return (
    <TextInput
      {...bodyTextInputProps()}
      {...rest}
      placeholderTextColor={colors.muted}
      style={[
        styles.borderedInput,
        { fontFamily: inputFont },
        style,
      ]}
    />
  );
}

export function AuthInlineTextInput({
  style,
  weight = "bold",
  ltr,
  ...rest
}: TextInputProps & { weight?: "regular" | "bold"; ltr?: boolean }) {
  const inputFont = useInputFont(weight);
  return (
    <TextInput
      {...bodyTextInputProps()}
      {...rest}
      placeholderTextColor={colors.muted}
      style={[
        styles.input,
        { fontFamily: inputFont },
        ltr && { writingDirection: "ltr" },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  field: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  ltr: { direction: "ltr" },
  prefix: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  input: { flex: 1, minHeight: 48, fontSize: fontSize.lg, color: colors.foreground },
  eye: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  borderedInput: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    fontSize: fontSize.lg,
    color: colors.foreground,
  },
});
