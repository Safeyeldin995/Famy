/**
 * Map raw Supabase rows into the UI shapes the Famy screens already render.
 * Keeping this in one place lets the rest of the app stay decoupled from the
 * exact database schema.
 */
import { currentLang } from "@/lib/i18n";

export interface UIProvider {
  id: string;
  name: string;
  category: string;
  categorySlug: string;
  role: "Professional" | "Angel";
  avatar: string;
  rating: number;
  reviews: number;
  yearsExp: number;
  jobs: number;
  hourlyRate: number;
  bio: string;
  languages: string[];
  areas: string[];
  badges: string[];
  trustScore: number;
  gender: "Female" | "Male";
  services: { name: string; status: "pending" | "approved" | "rejected" }[];
  gallery: string[];
  featured?: boolean;
}

function avatarFor(profile: any, providerId: string): string {
  return (
    profile?.avatar_url ||
    `https://i.pravatar.cc/300?u=${providerId}`
  );
}

function galleryFor(seed: string, n = 4): string[] {
  return Array.from({ length: n }, (_, i) => `https://picsum.photos/seed/${seed}${i}/600/400`);
}

/** Map a Supabase provider row (with joined profile/ratings/trust/services) to UIProvider. */
export function toUIProvider(row: any): UIProvider {
  const lang = currentLang();
  const profile = row.profile ?? {};
  const ratings = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
  const trust = Array.isArray(row.trust) ? row.trust[0] : row.trust;
  const firstService = row.services?.[0]?.service;
  const categorySlug: string = firstService?.category?.slug ?? "home-cleaning";
  const isKids = categorySlug === "babysitting";
  const bio = (lang === "ar" ? row.bio_ar : row.bio_en) || row.bio_en || "";

  const badges: string[] = [];
  if (row.is_verified) badges.push("ID Verified");
  if (row.is_verified) badges.push("Background Check");
  if (row.is_top_pro) badges.push("Famy Certified");
  if (isKids) badges.push("First Aid");

  return {
    id: row.id,
    name: profile.full_name || "",
    category: categorySlug,
    categorySlug,
    role: isKids ? "Angel" : "Professional",
    avatar: avatarFor(profile, row.id),
    rating: Number(ratings?.rating_avg ?? 0),
    reviews: Number(ratings?.rating_count ?? 0),
    yearsExp: row.years_experience ?? 0,
    jobs: Number(ratings?.rating_count ?? 0),
    hourlyRate: Number(row.hourly_rate ?? 0),
    bio,
    languages: row.languages ?? [],
    areas: [row.city ?? "Cairo"],
    badges,
    trustScore: Math.round(Number(trust?.score ?? 0)),
    gender: "Female",
    services: (row.services ?? [])
      .filter((ps: any) => ps.status === "approved" || ps.status === "pending")
      .map((ps: any) => ({
        name: (lang === "ar" ? ps.service?.name_ar : ps.service?.name_en) || ps.service?.name_en || "",
        status: ps.status,
      })),
    gallery: galleryFor(row.id),
    featured: !!row.is_top_pro,
  };
}

export interface UICategory {
  id: string; // slug
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  tint: string;
  color: string;
  fromPrice: number;
}

const CATEGORY_VISUALS: Record<string, { icon: string; tint: string; color: string; fromPrice: number }> = {
  "home-cleaning": { icon: "🏡", tint: "oklch(0.96 0.04 235)", color: "var(--navy)", fromPrice: 150 },
  babysitting:    { icon: "🧸", tint: "oklch(0.96 0.04 25)",  color: "var(--coral)", fromPrice: 180 },
  "elderly-care": { icon: "🤝", tint: "oklch(0.96 0.04 160)", color: "var(--mint)",  fromPrice: 220 },
  cooking:        { icon: "🍳", tint: "oklch(0.96 0.05 80)",  color: "var(--warning)", fromPrice: 200 },
  tutoring:       { icon: "📚", tint: "oklch(0.96 0.04 290)", color: "var(--navy)", fromPrice: 250 },
  "pet-care":     { icon: "🐾", tint: "oklch(0.96 0.04 200)", color: "var(--navy)", fromPrice: 140 },
};

export function toUICategory(row: any): UICategory {
  const lang = currentLang();
  const visuals = CATEGORY_VISUALS[row.slug] ?? CATEGORY_VISUALS["home-cleaning"];
  return {
    id: row.slug,
    title: (lang === "ar" ? row.name_ar : row.name_en) || row.name_en,
    subtitle: (lang === "ar" ? row.name_ar : row.name_en) || row.name_en,
    description:
      (lang === "ar" ? row.description_ar : row.description_en) ||
      row.description_en ||
      "",
    ...visuals,
  };
}
