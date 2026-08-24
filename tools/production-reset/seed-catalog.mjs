import crypto from "node:crypto";

/** From 20260712150000_seed-beta-services-catalog.sql — slug is authoritative keep key. */
export const SEED_SERVICE_SLUGS = [
  "regular-home-cleaning",
  "deep-home-cleaning",
  "move-in-out-cleaning",
  "hourly-babysitting",
  "full-day-babysitting",
  "overnight-babysitting",
  "elderly-companionship",
  "elderly-daily-assistance",
  "elderly-overnight-assistance",
  "daily-home-cooking",
  "weekly-meal-preparation",
  "small-gathering-cooking",
  "homework-support",
  "school-subject-tutoring",
  "language-tutoring",
  "pet-sitting",
  "dog-walking",
  "pet-feeding-home-visits",
];

export const SEED_SERVICE_SLUG_SET = new Set(SEED_SERVICE_SLUGS);

/** Literal prefix checks — never SQL ILIKE with underscore wildcard. */
export const QA_NAME_PREFIXES = ["QA_", "QA "];

/**
 * @param {string | null | undefined} nameEn
 */
export function isQaFixtureName(nameEn) {
  if (!nameEn) return false;
  return QA_NAME_PREFIXES.some((p) => nameEn.startsWith(p));
}

/**
 * @param {string[]} ids
 */
export function fingerprintSortedIds(ids) {
  const sorted = [...ids].sort();
  return crypto.createHash("sha256").update(sorted.join("\n")).digest("hex");
}

/**
 * @param {string} id
 */
export function maskId(id) {
  return id?.length >= 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "****";
}
