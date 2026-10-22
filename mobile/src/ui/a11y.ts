/** Keep tab icons and up to two scaled label lines clear of the safe-area inset. */
export function scaledTabBarHeight(
  fontScale: number,
  labelLineHeight: number,
  bottomInset: number,
) {
  const labelLines = fontScale > 1.3 ? 2 : 1;
  return Math.max(80, 44 + labelLines * labelLineHeight * fontScale + 12) + bottomInset;
}
