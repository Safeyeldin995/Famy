import type { TextStyle } from "react-native";
import { COMPACT_FONT_SCALE_CAP } from "./a11y";
import { colors, fontSize, fonts } from "./theme";

type FontWeight = "regular" | "bold" | "heavy";

function familyFor(language: string, weight: FontWeight = "regular") {
  return (language === "en" ? fonts.en : fonts.ar)[weight];
}

/** Expo Router stack titles — keep typography on theme tokens only. */
export function stackHeaderTitleStyle(
  language: string,
  weight: FontWeight = "heavy",
): TextStyle {
  return {
    fontFamily: familyFor(language, weight),
    fontSize: fontSize.xl,
    maxFontSizeMultiplier: COMPACT_FONT_SCALE_CAP,
    color: colors.brandText,
  } as TextStyle;
}

/** Bottom tab labels — React Navigation does not use the app Text component. */
export function tabBarLabelStyle(language: string): TextStyle {
  return {
    fontFamily: familyFor(language, "bold"),
    fontSize: fontSize.xs,
    lineHeight: 22,
    maxFontSizeMultiplier: COMPACT_FONT_SCALE_CAP,
  } as TextStyle;
}
