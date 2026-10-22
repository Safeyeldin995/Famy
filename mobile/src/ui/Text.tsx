import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { maxFontSizeMultiplierForText } from "./a11y";
import { colors, fonts, fontSize } from "./theme";

type Weight = "regular" | "bold" | "heavy";
type Tone = "default" | "muted" | "brand" | "inverse" | "danger" | "success";

const toneColor: Record<Tone, string> = {
  default: colors.foreground,
  muted: colors.muted,
  brand: colors.brandText,
  inverse: colors.brandForeground,
  danger: colors.destructive,
  success: colors.success,
};

/** App text: picks Almarai for Arabic and Manrope for English, like the web. */
export function Text({
  size = "md",
  weight = "regular",
  tone = "default",
  style,
  ...rest
}: TextProps & { size?: keyof typeof fontSize; weight?: Weight; tone?: Tone }) {
  const { i18n } = useTranslation();
  const family = (i18n.language === "en" ? fonts.en : fonts.ar)[weight];
  const base: TextStyle = {
    fontFamily: family,
    fontSize: fontSize[size],
    lineHeight: Math.round(fontSize[size] * 1.45),
    color: toneColor[tone],
    textAlign: "auto",
  };
  return (
    <RNText
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplierForText({ size, weight })}
      style={[base, style]}
    />
  );
}
