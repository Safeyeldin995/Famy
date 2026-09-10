import { Baby, BookOpen, ChefHat, Heart, Home, PawPrint, Sparkles } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { categoryTint } from "@/components/home/categoryTint";

const CATEGORY_ICON: Record<string, typeof Home> = {
  "home-cleaning": Sparkles,
  babysitting: Baby,
  "elderly-care": Heart,
  cooking: ChefHat,
  tutoring: BookOpen,
  "pet-care": PawPrint,
};

export function CategoryIcon({
  slug,
  className = "h-14 w-14",
}: {
  slug: string;
  className?: string;
}) {
  const Icon = CATEGORY_ICON[slug] ?? Home;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-2xl ${categoryTint(slug)} ${className}`}
    >
      <Icon className="h-6 w-6" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
    </span>
  );
}
