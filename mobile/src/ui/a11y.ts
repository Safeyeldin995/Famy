/** Max system font scale multipliers (accessibility on, but capped like the web type scale). */
export const BODY_FONT_SCALE_CAP = 1.3;
export const COMPACT_FONT_SCALE_CAP = 1.2;

const compactTextSizes = new Set(["hero", "title", "xxl", "xl"]);

export function maxFontSizeMultiplierForText(options: {
  size?: string;
  weight?: string;
  compact?: boolean;
}): number {
  if (options.compact) return COMPACT_FONT_SCALE_CAP;
  if (options.weight === "heavy" || options.weight === "bold") return COMPACT_FONT_SCALE_CAP;
  if (options.size && compactTextSizes.has(options.size)) return COMPACT_FONT_SCALE_CAP;
  return BODY_FONT_SCALE_CAP;
}

export function bodyTextInputProps() {
  return { allowFontScaling: true as const, maxFontSizeMultiplier: BODY_FONT_SCALE_CAP };
}

export function compactTextInputProps() {
  return { allowFontScaling: true as const, maxFontSizeMultiplier: COMPACT_FONT_SCALE_CAP };
}

/** Keep tab icons and up to two scaled label lines clear of the safe-area inset. */
export function scaledTabBarHeight(
  fontScale: number,
  labelLineHeight: number,
  bottomInset: number,
) {
  const labelLines = fontScale > 1.3 ? 2 : 1;
  return Math.max(80, 44 + labelLines * labelLineHeight * fontScale + 12) + bottomInset;
}
