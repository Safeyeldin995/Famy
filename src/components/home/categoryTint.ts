const CATEGORY_TINT: Record<string, string> = {
  "home-cleaning": "category-tint-sky",
  babysitting: "category-tint-pink",
  "elderly-care": "category-tint-lavender",
  cooking: "category-tint-orange",
  tutoring: "category-tint-peach",
  "pet-care": "category-tint-mint",
};

export function categoryTint(slug: string) {
  return CATEGORY_TINT[slug] ?? "category-tint-sky";
}
