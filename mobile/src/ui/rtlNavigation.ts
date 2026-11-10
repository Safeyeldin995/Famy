import { ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react-native";

/** Chevron for list rows: points backward in LTR, forward in RTL (toward the edge you came from). */
export function rowChevronIcon(language: string): LucideIcon {
  return language === "ar" ? ChevronLeft : ChevronRight;
}

/** Header back control: points toward the previous screen in reading direction. */
export function headerBackIcon(language: string): LucideIcon {
  return language === "ar" ? ArrowRight : ArrowLeft;
}
