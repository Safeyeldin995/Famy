import { Baby, BookOpen, ChefHat, Heart, Home, PawPrint, Sparkles } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

const CATEGORY_STYLE: Record<string, { tint: string; Icon: typeof Home }> = {
  "home-cleaning": { tint: "category-tint-sky", Icon: Sparkles },
  babysitting: { tint: "category-tint-pink", Icon: Baby },
  "elderly-care": { tint: "category-tint-lavender", Icon: Heart },
  cooking: { tint: "category-tint-orange", Icon: ChefHat },
  tutoring: { tint: "category-tint-peach", Icon: BookOpen },
  "pet-care": { tint: "category-tint-mint", Icon: PawPrint },
};

export function CategoryIcon({ slug, className = "h-14 w-14" }: { slug: string; className?: string }) {
  const style = CATEGORY_STYLE[slug] ?? { tint: "category-tint-sky", Icon: Home };
  const Icon = style.Icon;
  return (
    <span className={`grid shrink-0 place-items-center rounded-2xl ${style.tint} ${className}`}>
      <Icon className="h-6 w-6" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
    </span>
  );
}
