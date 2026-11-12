/** Shared star-rating constants and helpers (mobile + web). */
export const RATING_GOLD = "#F5B301";

export const STAR_RATINGS = [1, 2, 3, 4, 5] as const;
export type StarRatingValue = (typeof STAR_RATINGS)[number];

export function starRowDirection(language: string): "row" | "row-reverse" {
  return language.startsWith("ar") ? "row-reverse" : "row";
}

export function isStarFilled(star: StarRatingValue, value: number): boolean {
  return value > 0 && star <= value;
}

export function ratingLabelKey(value: StarRatingValue): `mobileBooking.starLabel${StarRatingValue}` {
  return `mobileBooking.starLabel${value}`;
}
