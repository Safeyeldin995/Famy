/**
 * Design tokens mirrored from the web app (`src/styles.css`) so both apps look
 * like one product. Keep names aligned with the web Tailwind tokens.
 */
export const colors = {
  brand: "#F10E72",
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
  destructive: "#D6342C",
  lavender: "#8E6CD8",
  lavenderTint: "#EFEAFB",
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Type scale shared with the web (`--text-pro-*`). */
export const fontSize = { xs: 12, sm: 13, md: 14, lg: 16, xl: 18, xxl: 22, title: 26, hero: 30 } as const;

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
