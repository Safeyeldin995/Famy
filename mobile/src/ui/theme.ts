/**
 * Design tokens mirrored from the web app (`src/styles.css`) so both apps look
 * like one product. Keep names aligned with the web Tailwind tokens.
 */
export const colors = {
  brand: "#F10E72",
  // 4.53:1 against brandTint and 5.22:1 against white for normal-size text.
  brandText: "#D40C60",
  brandForeground: "#FFFFFF",
  brandTint: "#FDEAF2",
  brandTintStrong: "#FBD3E5",
  ink: "#2A1E25",
  foreground: "#1F1419",
  muted: "#6F6168",
  background: "#FFFCFD",
  surface: "#FFFFFF",
  surface2: "#F3EEF0",
  border: "#E7DEE2",
  success: "#1F9D63",
  warning: "#D88A0B",
  ratingGold: "#F5B301",
  destructive: "#D6342C",
  lavender: "#8E6CD8",
  lavenderTint: "#EFEAFB",
  destructiveTint: "#FBE7E6",
  successTint: "#E7F7EF",
  warningTint: "#FFF5DF",
  composerWarningTint: "#FEF3C7",
  brandGradientStart: "#F32B88",
  /** Online / typing indicator chip above chat threads. */
  chatPresenceNotice: "#D9F5E780",
  brandHighlightOverlay: "#F10E7208",
  statusCompletedBg: "#1F9D6326",
  statusPendingBg: "#F10E721A",
  statusActiveBg: "#2A1E251A",
  /** Apple Pay / Sign in with Apple marks (brand-mandated). */
  paymentMarkBackground: "#000000",
  paymentMarkForeground: "#FFFFFF",
  oauthAppleBackground: "#000000",
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/**
 * Mobile type scale (phone density, smaller than the desktop web scale).
 * Arabic (Almarai) renders larger than Manrope at the same px, so `Text`
 * applies `ARABIC_FONT_FACTOR` on top of these values.
 */
export const fontSize = {
  xs: 11,
  sm: 12,
  /** Default body copy. */
  md: 14,
  lg: 15,
  xl: 16,
  /** Section titles. */
  xxl: 18,
  button: 15,
  title: 20,
  hero: 24,
  /** Customer hero header title on gradient screens. */
  heroTitle: 22,
  heroTitleLine: 28,
} as const;

/** Almarai is drawn visually larger than Manrope; shrink Arabic text to match. */
export const ARABIC_FONT_FACTOR = 0.94;

/** Font size for the active language (Arabic scaled by `ARABIC_FONT_FACTOR`, rounded to 0.5). */
export function scaledFontSize(px: number, language: string): number {
  if (language === "en") return px;
  return Math.round(px * ARABIC_FONT_FACTOR * 2) / 2;
}

/** Line height: 1.35× for body sizes, 1.2× for headings (16px and up). */
export function lineHeightFor(px: number): number {
  return Math.round(px * (px >= 16 ? 1.2 : 1.35));
}

const AVATAR_INITIAL_BY_DIAMETER: { min: number; size: keyof typeof fontSize }[] = [
  { min: 64, size: "title" },
  { min: 48, size: "xxl" },
  { min: 0, size: "lg" },
];

export function fontSizeTokenForAvatarInitial(diameter: number): keyof typeof fontSize {
  return AVATAR_INITIAL_BY_DIAMETER.find((row) => diameter >= row.min)!.size;
}

export const fonts = {
  ar: { regular: "Almarai_400Regular", bold: "Almarai_700Bold", heavy: "Almarai_800ExtraBold" },
  en: { regular: "Manrope_400Regular", bold: "Manrope_700Bold", heavy: "Manrope_800ExtraBold" },
} as const;

export const shadow = {
  card: {
    shadowColor: "#2A1E25",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
} as const;
