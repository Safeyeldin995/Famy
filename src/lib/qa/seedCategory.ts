import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SEEDED_CATEGORY_COUNT = 6;

/**
 * Require a seeded catalog category — never create unregistered shared categories from tests.
 */
export async function requireSeededCategory(
  admin: SupabaseClient<Database>,
  slug: string,
): Promise<string> {
  const { data, error } = await admin
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error(
      `Expected seeded category "${slug}" missing — QA schema invariant requires ${SEEDED_CATEGORY_COUNT} categories`,
    );
  }
  return data.id;
}

export { SEEDED_CATEGORY_COUNT };
