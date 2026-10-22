import { useRef } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  OTP_LENGTH,
  applyOtpBackspace,
  applyOtpDigitInput,
} from "@/lib/auth/otpCodeInputLogic";
import { colors, fonts, radius, space } from "./theme";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  inputFont: string;
};

export function OtpCodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  inputFont,
}: Props) {
  const refs = useRef<Array<TextInput | null>>([]);
  const { t } = useTranslation();

  const focusAt = (index: number) => {
    refs.current[index]?.focus();
  };

  const handleInput = (index: number, raw: string) => {
    const result = applyOtpDigitInput(value, index, raw);
    onChange(result.next);
    focusAt(result.focusIndex);
    if (result.complete) onComplete?.(result.next.join(""));
  };

  return (
    <View style={styles.row} accessibilityRole="none">
      {value.map((digit, index) => (
        <TextInput
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={digit}
          editable={!disabled}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          textContentType="oneTimeCode"
          autoComplete={index === 0 ? "sms-otp" : "off"}
          accessibilityLabel={t("auth.otpDigitLabel", {
            position: index + 1,
            total: OTP_LENGTH,
          })}
          onChangeText={(text) => handleInput(index, text)}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === "Backspace") {
              const result = applyOtpBackspace(value, index);
              onChange(result.next);
              focusAt(result.focusIndex);
            }
          }}
          style={[
            styles.cell,
            { fontFamily: inputFont },
            invalid && styles.cellInvalid,
            disabled && styles.cellDisabled,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    gap: space.sm,
    direction: "ltr",
  },
  cell: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    textAlign: "center",
    fontSize: 22,
    color: colors.foreground,
  },
  cellInvalid: { borderColor: colors.destructive },
  cellDisabled: { opacity: 0.6 },
});
