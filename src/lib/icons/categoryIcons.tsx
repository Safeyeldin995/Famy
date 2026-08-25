import {
  Baby,
  BookOpen,
  ChefHat,
  HeartHandshake,
  Home,
  PawPrint,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { ICON_STROKE } from "./constants";

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  "home-cleaning": Sparkles,
  babysitting: Baby,
  "elderly-care": HeartHandshake,
  cooking: ChefHat,
  tutoring: BookOpen,
  "pet-care": PawPrint,
};

export function getCategoryIcon(slug: string): LucideIcon {
  return CATEGORY_ICON_MAP[slug] ?? Home;
}

export function CategoryIcon({
  slug,
  className = "h-6 w-6",
  strokeWidth = ICON_STROKE,
}: {
  slug: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = getCategoryIcon(slug);
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
